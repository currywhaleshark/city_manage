import {
  CONFIG,
  createDemand,
  createNetwork,
  DEFAULT_POLICY,
} from "./scenario";
import type {
  CompletedTrip,
  Crossing,
  Lane,
  Network,
  PolicySelection,
  Pose,
  Trip,
  Vehicle,
} from "./types";
import { idmAccel } from "./simulation/idm";
import {
  createCrossing,
  createArrival,
  crossingPose,
  findRoute,
  signalPhase,
  curvePoint,
} from "./simulation/network";
import { planVehicleDeparture, planVehicleArrival, type DeparturePlan, type ArrivalPlan } from "./simulation/vehicle-access";
import { inCityBounds } from "./city/world";
import { collectMetrics } from "./metrics";
import { validatePolicy } from "./policies";
import {
  CLEAR_DISTANCE,
  movementsConflict,
  sameMovement,
} from "./simulation/junctions";
import {
  LANE_CHANGE,
  assessLaneChange,
  laneChangePose,
  neighbours,
  occupiesLane,
  permitsRoute,
} from "./simulation/lanes";

import {
  PedestrianSystem,
  type PedestrianTrip,
} from "./simulation/pedestrians";
export const MODEL_VERSION = "city-traffic-v5";
export class TrafficSimulation {
  /** Transport-only service journeys; loading and mission decisions live outside this engine. */
  readonly serviceJourneys = new Map<
    number,
    { stopLaneId: string; route: string[]; arrived: boolean }
  >();
  readonly servicePending: Trip[] = [];
  readonly pedestrians: PedestrianSystem;
  readonly network: Network;
  demand: readonly Trip[];
  readonly policy: PolicySelection;
  readonly vehicles = new Map<number, Vehicle>();
  readonly completed: CompletedTrip[] = [];
  readonly pending: Trip[] = [];
  readonly nodeLocks = new Map<string, Set<number>>();
  readonly laneReservations = new Map<string, Set<number>>();
  readonly movementReservations = new Map<number, Crossing>();
  readonly laneChangeEvents: {
    time: number;
    vehicle: number;
    from: string;
    to: string;
    reason: "route" | "flow";
    incentive: number;
  }[] = [];
  readonly events: {
    time: number;
    vehicle: number;
    node: string;
    phase: string;
    type: "enter" | "arrive";
    fromLaneId?: string;
    nextLaneId?: string;
    entrySpeed?: number;
  }[] = [];
  readonly history: { time: number; stopped: number; arrived: number }[] = [];
  private released = 0;
  private ticks = 0;
  private accumulated = 0;
  private routeCache = new Map<string, string[]>();
  private movementCache = new Map<string, Crossing>();
  private laneCache = new Map<string, Vehicle[]>();
  private departureCache = new Map<string, DeparturePlan | undefined>();
  private arrivalCache = new Map<string, ArrivalPlan | undefined>();
  constructor(
    policy: PolicySelection = DEFAULT_POLICY,
    demand: readonly Trip[] = createDemand(),
    network?: Network,
    pedestrianDemand: readonly PedestrianTrip[] = [],
    readonly transport?: TrafficSimulation,
  ) {
    validatePolicy(policy);
    this.policy = { ...policy };
    this.demand = demand;
    this.network = transport?.network ?? network ?? createNetwork(policy);
    this.pedestrians =
      transport?.pedestrians ??
      new PedestrianSystem(this.network, pedestrianDemand);
    // Domain services share the world's transport state. Only its owner advances physics.
    if (transport) {
      this.vehicles = transport.vehicles;
      this.serviceJourneys = transport.serviceJourneys;
      this.servicePending = transport.servicePending;
      this.nodeLocks = transport.nodeLocks;
      this.laneReservations = transport.laneReservations;
      this.movementReservations = transport.movementReservations;
    }
  }
  get time(): number {
    return this.transport ? this.transport.time : this.ticks * CONFIG.dt;
  }
  get usesVehicleAccess(): boolean { return this.transport?.usesVehicleAccess ?? false; }
  get usesVehicleArrivals(): boolean { return this.transport?.usesVehicleArrivals ?? false; }
  get stats() {
    return collectMetrics(this);
  }
  get alpha() {
    return Math.min(1, this.accumulated / CONFIG.dt);
  }
  get releasedCount() {
    return this.released;
  }
  scheduleDemand(trips: readonly Trip[]) {
    this.demand = [...this.demand.slice(this.released), ...trips].sort(
      (a, b) => a.departAt - b.departAt,
    );
    this.released = 0;
  }
  route(origin: string, destination: string) {
    const key = `${origin}>${destination}`;
    if (!this.routeCache.has(key))
      this.routeCache.set(key, findRoute(this.network, origin, destination));
    return this.routeCache.get(key)!;
  }
  invalidateRoutes() {
    this.routeCache.clear();
    this.departureCache.clear();
    this.arrivalCache.clear();
  }
  dispatchService(
    id: number,
    origin: string,
    stopLaneId: string,
    color = 0xda963c,
  ) {
    const stop = this.network.lanes.get(stopLaneId);
    if (!stop) throw new Error("수거 지점으로 들어가는 도로가 없어요.");
    const car = this.vehicles.get(id);
    if (car && !this.serviceJourneys.get(id)?.arrived)
      throw new Error("운행 중인 서비스 차량의 임무를 바꿀 수 없어요.");
    if (
      !car &&
      (this.demand.some((t) => t.id === id) || this.serviceJourneys.has(id))
    )
      throw new Error("서비스 차량 ID가 겹쳐요.");
    const current = car && this.network.lanes.get(car.laneId)!;
    const start = current?.to ?? origin;
    const prefix = findRoute(this.network, start, stop.from, (road) =>
      road === stop.roadId || road === current?.roadId ? Infinity : 0,
    );
    if (start !== stop.from && !prefix.length) return false;
    const route = [
      ...(current ? [current.roadId] : []),
      ...prefix,
      stop.roadId,
    ];
    const trip: Trip = {
      id,
      origin: current?.from ?? origin,
      destination: stop.to,
      departAt: this.time,
      purpose: "work",
      targetSpeed: 6.5,
      color,
    };
    this.serviceJourneys.set(id, { stopLaneId, route, arrived: false });
    if (car) {
      car.trip = trip;
      car.route = route;
      car.routeIndex = 0;
      this.releaseReservation(id);
    } else this.servicePending.push(trip);
    return true;
  }
  retireService(id: number) {
    if (!this.serviceJourneys.get(id)?.arrived)
      throw new Error("도착한 서비스 차량만 운행을 마칠 수 있어요.");
    this.releaseReservation(id);
    this.vehicles.delete(id);
    this.serviceJourneys.delete(id);
    this.laneCache.clear();
  }
  advance(seconds: number) {
    if (this.transport)
      throw new Error("공유 서비스는 도시의 시계로 진행해야 해요.");
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.accumulated += seconds;
    while (this.accumulated + 1e-9 >= CONFIG.dt) {
      this.step();
      this.accumulated -= CONFIG.dt;
    }
    if (this.accumulated < 0) this.accumulated = 0;
  }
  runUntil(seconds: number) {
    if (this.transport)
      throw new Error("공유 서비스는 도시의 시계로 진행해야 해요.");
    while (this.time + 1e-9 < seconds) this.step();
  }
  private laneCars(laneId: string) {
    if (!this.laneCache.size) {
      // Index occupied lanes once per step, instead of scanning every car for every road.
      for (const id of this.network.lanes.keys()) this.laneCache.set(id, []);
      for (const car of this.vehicles.values()) {
        if (car.crossing || (car.departure && !car.departure.merging) || car.arrival?.progress === 1) continue;
        this.laneCache.get(car.laneId)!.push(car);
        if (car.laneChange && car.laneChange.toLaneId !== car.laneId)
          this.laneCache.get(car.laneChange.toLaneId)!.push(car);
      }
      for (const cars of this.laneCache.values())
        cars.sort((a, b) => b.s - a.s || a.id - b.id);
    }
    const cached = this.laneCache.get(laneId);
    if (cached) return cached;
    const cars = [...this.vehicles.values()]
      .filter((v) => occupiesLane(v, laneId))
      .sort((a, b) => b.s - a.s || a.id - b.id);
    this.laneCache.set(laneId, cars);
    return cars;
  }
  private availableLane(
    roadId: string,
    from: string,
    nextRoadId?: string,
    incomingLaneId?: string,
  ): Lane | undefined {
    const lanes = (this.network.outgoing.get(from) ?? []).filter(
      (lane) =>
        lane.roadId === roadId && permitsRoute(this.network, lane, nextRoadId),
    );
    return lanes
      .sort(
        (a, b) =>
          Number(!!this.laneReservations.get(b.id)?.size) -
            Number(!!this.laneReservations.get(a.id)?.size) ||
          this.laneCars(a.id).length - this.laneCars(b.id).length ||
          a.index - b.index,
      )
      .find((lane) => {
        const cars = this.laneCars(lane.id),
          tail = cars[cars.length - 1];
        const reservations =
          this.laneReservations.get(lane.id) ?? new Set<number>();
        // Occupied cars plus outstanding claims must fit as a stopped queue.
        // Moving traffic may be followed; a stopped tail at the entrance closes it.
        const storageAvailable =
          (cars.length + reservations.size + 1) * CLEAR_DISTANCE <= lane.length;
        const entranceAvailable =
          !tail ||
          tail.s >= CLEAR_DISTANCE + 3 ||
          (incomingLaneId !== undefined && tail.speed >= 0.3);
        return (
          [...reservations].every(
            (id) =>
              incomingLaneId !== undefined &&
              this.movementReservations.get(id)?.fromLaneId === incomingLaneId,
          ) &&
          !cars.some((car) => car.laneChange) &&
          storageAvailable &&
          entranceAvailable
        );
      });
  }
  private spawn() {
    while (
      this.released < this.demand.length &&
      this.demand[this.released].departAt <= this.time + 1e-9
    )
      this.pending.push(this.demand[this.released++]);
    const blocked = new Set<string>();
    for (const queue of [this.pending, this.servicePending])
      for (let i = 0; i < queue.length;) {
        const trip = queue[i];
        const origin = this.network.nodes.get(trip.origin);
        const local = this.usesVehicleAccess && origin && !origin.boundary && inCityBounds(origin.position);
        let departure: DeparturePlan | undefined;
        if (local) {
          const stop = this.serviceJourneys.get(trip.id)?.stopLaneId;
          const key = `${trip.origin}|${trip.destination}|${stop ?? ""}`;
          if (!this.departureCache.has(key))
            this.departureCache.set(key, planVehicleDeparture(this.network, trip, stop));
          departure = this.departureCache.get(key);
          if (!departure || this.accessBusy(departure.access.id) ||
            [...this.vehicles.values()].some(v =>
              v.arrival?.accessId === departure!.access.id && this.atArrivalLane(v) &&
              v.arrival.entryS - v.s < 12)) {
            i++;
            continue;
          }
        }
        const destination = this.network.nodes.get(trip.destination);
        const localArrival = this.usesVehicleArrivals && !this.serviceJourneys.has(trip.id) &&
          destination && !destination.boundary && inCityBounds(destination.position);
        let arrival: ArrivalPlan | undefined;
        if (localArrival) {
          const key = `${trip.origin}|${trip.destination}|${departure?.access.id ?? ""}`;
          if (!this.arrivalCache.has(key))
            this.arrivalCache.set(key, planVehicleArrival(this.network, trip, departure));
          arrival = this.arrivalCache.get(key);
          if (!arrival) { i++; continue; }
        }
        const route = arrival?.route ?? departure?.route ??
            this.serviceJourneys.get(trip.id)?.route ??
            this.route(trip.origin, trip.destination);
        const entrance = `${trip.origin}|${route[0]}|${route[1]}`;
        // Spawning only occupies space during this phase. A closed identical entrance
        // cannot reopen until the next physics step; keep all demand queued, in order.
        if (blocked.has(entrance)) {
          i++;
          continue;
        }
        const lane = departure ? this.network.lanes.get(departure.access.laneId) : route.length
          ? this.availableLane(route[0], trip.origin, route[1])
          : undefined;
        if (!lane) {
          blocked.add(entrance);
          i++;
          continue;
        }
        const startS = departure?.access.startS ?? (this.network.nodes.get(trip.origin)?.boundary
          ? -CONFIG.junctionRadius
          : 0);
        const pose = departure ? curvePoint(departure.access.points, 0) : this.lanePose(lane, startS);
        if (
          startS < 0 &&
          (this.nodeLocks.get(trip.origin)?.size ||
            [...this.vehicles.values()].some(
              (v) =>
                Math.hypot(v.pose.x - pose.x, v.pose.z - pose.z) <
                CLEAR_DISTANCE + 3,
            ))
        ) {
          i++;
          continue;
        }
        this.vehicles.set(trip.id, {
          id: trip.id,
          trip,
          laneId: lane.id,
          route: [...route],
          routeIndex: 0,
          s: startS,
          speed: 0,
          acceleration: 0,
          maxAccel: 1.8,
          comfortBrake: 2.8,
          safetyGap: CONFIG.minimumGap,
          headway: 1.1,
          waitingTime: this.time - trip.departAt,
          enteredAt: this.time,
          ...(departure ? { departure: {
            accessId: departure.access.id, points: departure.access.points,
            mergeS: departure.access.mergeS, progress: 0, merging: false,
          } } : {}),
          ...(arrival ? { arrival: {
            accessId: arrival.access.id, laneId: arrival.access.laneId,
            entryS: arrival.entryS, points: arrival.points,
          } } : {}),
          pose,
          previousPose: { ...pose },
        });
        queue.splice(i, 1);
        const service = this.serviceJourneys.get(trip.id);
        if (service && departure) service.route = [...route];
        this.laneCache.delete(lane.id);
      }
  }
  private atArrivalLane(car: Vehicle) {
    return !!car.arrival && car.laneId === car.arrival.laneId &&
      car.routeIndex === car.route.length - 1;
  }
  private accessBusy(id: string, except?: number) {
    return [...this.vehicles.values()].some(car => car.id !== except &&
      (car.departure?.accessId === id ||
        (car.arrival?.accessId === id && car.arrival.progress !== undefined)));
  }
  private arrivalLaneClear(car: Vehicle) {
    const lane = this.network.lanes.get(car.laneId)!, bay = car.arrival!.points[3];
    const bayS = ((bay.x - lane.start.x) * (lane.end.x - lane.start.x) +
      (bay.z - lane.start.z) * (lane.end.z - lane.start.z)) / lane.length;
    // The curve sweeps forward before leaving the road. A slow leader must clear
    // that whole area; a free parking bay alone does not make the turn safe.
    return !this.laneCars(lane.id).some(other => other.id !== car.id &&
      other.s > car.s && other.s < bayS + CLEAR_DISTANCE);
  }
  private advanceArrivals(dt: number) {
    for (const car of this.vehicles.values()) {
      const arrival = car.arrival;
      if (!arrival || arrival.progress === undefined) continue;
      car.speed = 0;
      if (arrival.progress < 1) {
        arrival.progress = Math.min(1, arrival.progress + dt / 4);
        const t = arrival.progress;
        car.pose = curvePoint(arrival.points, t * t * (3 - 2 * t));
        if (arrival.progress === 1) this.laneCache.clear();
      } else {
        arrival.parkedFor = (arrival.parkedFor ?? 0) + dt;
        if (arrival.parkedFor >= 1 - 1e-8) this.arrive(car);
      }
    }
  }
  private advanceDepartures(dt: number) {
    for (const car of this.vehicles.values()) {
      const departure = car.departure;
      if (!departure) continue;
      if (!departure.merging) {
        // Leave room ahead and let approaching cars pass before committing to the turn.
        const blocked = this.laneCars(car.laneId).some(other =>
          other.s >= car.s
            ? other.s < departure.mergeS + CLEAR_DISTANCE + 1
            : car.s - other.s < CLEAR_DISTANCE + 1 + other.speed * 4);
        if (blocked || this.laneReservations.get(car.laneId)?.size) {
          car.waitingTime += dt;
          continue;
        }
        departure.merging = true;
        this.laneCache.clear();
      }
      departure.progress = Math.min(1, departure.progress + dt / 4);
      car.pose = curvePoint(departure.points, departure.progress);
      // The reserved obstacle stays at the start of the swept area until clear.
      car.speed = 0;
      if (departure.progress >= 1) {
        car.s = departure.mergeS;
        car.speed = 2;
        car.departure = undefined;
        this.laneCache.clear();
      }
    }
  }
  lanePose(lane: Lane, s: number): Pose {
    const t = s / lane.length;
    return {
      x: lane.start.x + (lane.end.x - lane.start.x) * t,
      z: lane.start.z + (lane.end.z - lane.start.z) * t,
      angle: Math.atan2(lane.end.x - lane.start.x, lane.end.z - lane.start.z),
    };
  }
  private releaseReservation(id: number) {
    const plan = this.movementReservations.get(id);
    if (!plan) return;
    this.movementReservations.delete(id);
    const locks = this.nodeLocks.get(plan.nodeId);
    locks?.delete(id);
    if (!locks?.size) this.nodeLocks.delete(plan.nodeId);
    this.releaseExit(plan.nextLaneId, id);
  }
  private releaseExit(laneId: string, id: number) {
    const reservations = this.laneReservations.get(laneId);
    reservations?.delete(id);
    if (!reservations?.size) this.laneReservations.delete(laneId);
  }
  /** Continuous centre position along approach -> curve -> exit for car following. */
  private pathLeader(plan: Crossing, self: Vehicle, distance: number) {
    let leader: { car: Vehicle; distance: number } | undefined;
    const consider = (car: Vehicle, at: number) => {
      if (
        car.id !== self.id &&
        at > distance + 1e-8 &&
        (!leader || at < leader.distance)
      )
        leader = { car, distance: at };
    };
    for (const id of this.nodeLocks.get(plan.nodeId) ?? []) {
      const otherPlan = this.movementReservations.get(id)!;
      if (!sameMovement(plan, otherPlan)) continue;
      const car = this.vehicles.get(id)!;
      if (car.crossing) consider(car, car.crossing.distance);
      else if (car.laneId === plan.fromLaneId)
        consider(car, car.s - this.network.lanes.get(car.laneId)!.length);
      else if (car.laneId === plan.nextLaneId)
        consider(car, plan.length + car.s);
    }
    if (plan.nextLaneId)
      for (const car of this.laneCars(plan.nextLaneId))
        consider(car, plan.length + car.s);
    return leader;
  }
  private releaseLocks() {
    for (const [id, plan] of this.movementReservations) {
      const car = this.vehicles.get(id);
      if (!car) {
        this.releaseReservation(id);
        continue;
      }
      if (car.crossing) continue;
      const approaching = car.laneId === plan.fromLaneId;
      const lane = this.network.lanes.get(car.laneId)!;
      if (
        approaching
          ? signalPhase(
              this.network.nodes.get(plan.nodeId)!.signal,
              this.time,
            ) !== `${lane.axis}-green`
          : car.s >= CLEAR_DISTANCE
      )
        this.releaseReservation(id);
    }
  }
  private movement(from: string, to: string) {
    const key = `${from}>${to}`;
    if (!this.movementCache.has(key))
      this.movementCache.set(
        key,
        to
          ? createCrossing(this.network, from, to)
          : createArrival(this.network, from),
      );
    return this.movementCache.get(key)!;
  }
  private planLaneChanges() {
    const candidates = [...this.vehicles.values()]
      .filter(
        (car) =>
          !car.crossing &&
          !car.departure &&
          car.arrival?.progress === undefined &&
          !car.laneChange &&
          !this.movementReservations.has(car.id),
      )
      .sort((a, b) => a.trip.departAt - b.trip.departAt || a.id - b.id);
    for (const car of candidates) {
      const lane = this.network.lanes.get(car.laneId)!;
      if (
        this.network.roads.get(lane.roadId)!.laneCount < 2 ||
        car.s < CLEAR_DISTANCE + 1 ||
        car.s >
          lane.length -
            LANE_CHANGE.junctionMargin -
            LANE_CHANGE.distance +
            1e-8 ||
        this.time - (car.lastLaneChangeAt ?? -Infinity) < LANE_CHANGE.cooldown
      )
        continue;
      const nextRoad = car.route[car.routeIndex + 1];
      const required = !permitsRoute(this.network, lane, nextRoad);
      const targets = (this.network.outgoing.get(lane.from) ?? []).filter(
        (target) =>
          target.roadId === lane.roadId &&
          target.to === lane.to &&
          Math.abs(target.index - lane.index) === 1 &&
          permitsRoute(this.network, target, nextRoad),
      );
      let best: { lane: Lane; incentive: number } | undefined;
      for (const target of targets) {
        // Claim both lanes for the manoeuvre; exclude incoming junction traffic and competing merges.
        const pair = [lane.id, target.id];
        if (
          [...this.movementReservations.values()].some((plan) =>
            pair.includes(plan.nextLaneId),
          ) ||
          [...this.vehicles.values()].some(
            (other) =>
              other.laneChange &&
              (pair.includes(other.laneId) ||
                pair.includes(other.laneChange.toLaneId)),
          )
        )
          continue;
        const decision = assessLaneChange(
          car,
          this.laneCars(lane.id),
          this.laneCars(target.id),
          target,
          this.network.roads.get(lane.roadId)!.speedLimit,
          required,
        );
        if (decision.allowed && (!best || decision.incentive > best.incentive))
          best = { lane: target, incentive: decision.incentive };
      }
      if (!best) continue;
      const reason = required ? "route" : "flow";
      car.laneChange = {
        fromLaneId: lane.id,
        toLaneId: best.lane.id,
        startS: car.s,
        length: LANE_CHANGE.distance,
        reason,
      };
      this.laneChangeEvents.push({
        time: this.time,
        vehicle: car.id,
        from: lane.id,
        to: best.lane.id,
        reason,
        incentive: best.incentive,
      });
      this.laneCache.clear();
    }
  }
  private reserveApproaches() {
    const candidates: { car: Vehicle; rank: number }[] = [];
    for (const lane of this.network.lanes.values()) {
      if (this.pedestrians.blockedNodes.has(lane.to)) continue;
      for (const [rank, lead] of this.laneCars(lane.id).entries()) {
        if (
          !lead ||
          lead.departure ||
          this.atArrivalLane(lead) ||
          this.serviceJourneys.get(lead.id)?.stopLaneId === lane.id ||
          lead.laneChange ||
          this.movementReservations.has(lead.id) ||
          !permitsRoute(this.network, lane, lead.route[lead.routeIndex + 1])
        )
          continue;
        // Only reserve a nearby approach; red/yellow always keeps the stop line.
        const approach = Math.min(20, Math.max(12, lead.speed * 1.8));
        if (
          lane.length - lead.s <= approach &&
          signalPhase(this.network.nodes.get(lane.to)!.signal, this.time) ===
            `${lane.axis}-green`
        )
          candidates.push({ car: lead, rank });
      }
    }
    // Front-to-back within each lane; no follower may reserve across an unserved leader.
    candidates.sort(
      (a, b) =>
        a.rank - b.rank ||
        a.car.trip.departAt - b.car.trip.departAt ||
        a.car.id - b.car.id,
    );
    for (const { car } of candidates) {
      const lane = this.network.lanes.get(car.laneId)!;
      const out =
        !car.arrival && !this.serviceJourneys.has(car.id) && lane.to === car.trip.destination
          ? undefined
          : this.availableLane(
              car.route[car.routeIndex + 1],
              lane.to,
              car.route[car.routeIndex + 2],
              lane.id,
            );
      if (
        (car.arrival || this.serviceJourneys.has(car.id) ||
          lane.to !== car.trip.destination) &&
        !out
      )
        continue;
      const plan = this.movement(lane.id, out?.id ?? "");
      const before = neighbours(this.laneCars(lane.id), car).leader;
      const beforePlan = before && this.movementReservations.get(before.id);
      if (before && (!beforePlan || !sameMovement(plan, beforePlan))) continue;
      const locks = this.nodeLocks.get(lane.to) ?? new Set<number>();
      if (
        [...locks].some(
          (id) =>
            !sameMovement(plan, this.movementReservations.get(id)!) &&
            movementsConflict(
              this.network,
              plan,
              this.movementReservations.get(id)!,
            ),
        )
      )
        continue;
      const ahead = this.pathLeader(plan, car, car.s - lane.length);
      if (ahead && ahead.distance - (car.s - lane.length) < CLEAR_DISTANCE)
        continue;
      locks.add(car.id);
      this.nodeLocks.set(lane.to, locks);
      this.movementReservations.set(car.id, plan);
      if (out) {
        const reservations =
          this.laneReservations.get(out.id) ?? new Set<number>();
        reservations.add(car.id);
        this.laneReservations.set(out.id, reservations);
      }
    }
  }
  private arrive(v: Vehicle) {
    this.completed.push({
      id: v.id,
      travelTime: this.time - v.trip.departAt,
      waitingTime: v.waitingTime,
      purpose: v.trip.purpose,
    });
    this.events.push({
      time: this.time,
      vehicle: v.id,
      node: v.trip.destination,
      phase: "destination",
      type: "arrive",
    });
    this.vehicles.delete(v.id);
    this.releaseReservation(v.id);
  }
  step() {
    if (this.transport) return;
    const dt = CONFIG.dt;
    this.laneCache.clear();
    this.ticks++;
    this.releaseLocks();
    this.pedestrians.step(this.time, dt, this.nodeLocks);
    this.spawn();
    for (const v of this.vehicles.values()) v.previousPose = { ...v.pose };
    const transferred = new Set<number>();
    for (const v of this.vehicles.values()) if (v.departure) transferred.add(v.id);
    for (const v of this.vehicles.values()) if (v.arrival?.progress !== undefined) transferred.add(v.id);
    this.advanceArrivals(dt);
    this.advanceDepartures(dt);
    const crossingUpdates = new Map<
      number,
      { distance: number; speed: number; acceleration: number }
    >();
    for (const v of this.vehicles.values())
      if (v.crossing) {
        const c = v.crossing;
        const ahead = this.pathLeader(c, v, c.distance);
        const gap = ahead
          ? ahead.distance - c.distance - CONFIG.carLength
          : 1e6;
        const target = Math.min(c.speedLimit, v.trip.targetSpeed);
        const acceleration = Math.max(
          -8,
          Math.min(
            v.maxAccel,
            idmAccel(
              v,
              v.speed,
              gap,
              ahead ? v.speed - ahead.car.speed : 0,
              target,
            ),
          ),
        );
        const oldSpeed = v.speed;
        let speed = Math.max(0, v.speed + acceleration * dt);
        const cap = ahead ? ahead.distance - CLEAR_DISTANCE : Infinity;
        const distance = Math.max(
          c.distance,
          Math.min(c.length, cap, c.distance + (oldSpeed + speed) * 0.5 * dt),
        );
        if (distance >= cap - 1e-8) speed = 0;
        crossingUpdates.set(v.id, { distance, speed, acceleration });
      }
    for (const [id, update] of crossingUpdates) {
      const v = this.vehicles.get(id)!,
        c = v.crossing!;
      v.speed = update.speed;
      v.acceleration = update.acceleration;
      c.distance = update.distance;
      c.progress = c.distance / c.length;
      if (v.speed < 0.3) v.waitingTime += dt;
      v.pose = crossingPose(c, c.distance);
      if (c.progress >= 1) {
        if (!c.nextLaneId) {
          this.arrive(v);
          continue;
        }
        v.laneId = c.nextLaneId;
        v.s = 0;
        v.routeIndex++;
        this.releaseExit(c.nextLaneId, v.id);
        v.crossing = undefined;
        this.laneCache.delete(v.laneId);
        transferred.add(v.id);
      }
    }
    this.planLaneChanges();
    this.reserveApproaches();
    const next = new Map<number, { s: number; speed: number }>();
    const entrants: Vehicle[] = [];
    for (const lane of this.network.lanes.values()) {
      const cars = this.laneCars(lane.id);
      for (let index = 0; index < cars.length; index++) {
        const v = cars[index];
        if (transferred.has(v.id) || v.laneId !== lane.id) continue;
        const service = this.serviceJourneys.get(v.id);
        if (service?.arrived) {
          next.set(v.id, { s: v.s, speed: 0 });
          continue;
        }
        let leader = cars[index - 1];
        if (v.laneChange) {
          const adjacent = neighbours(
            this.laneCars(v.laneChange.toLaneId),
            v,
          ).leader;
          if (adjacent && (!leader || adjacent.s < leader.s)) leader = adjacent;
        }
        let cap = Infinity,
          gap = 1e6,
          closing = 0;
        if (leader) {
          gap = leader.s - v.s - CONFIG.carLength;
          closing = v.speed - leader.speed;
          cap =
            leader.s -
            (v.laneChange || leader.laneChange
              ? Math.hypot(CONFIG.carLength, CONFIG.carWidth)
              : CONFIG.carLength) -
            0.15;
        }
        const plan = this.movementReservations.get(v.id);
        const permitted = plan?.fromLaneId === lane.id;
        const stopAt =
          this.atArrivalLane(v)
            ? v.arrival!.entryS
            : service?.stopLaneId === lane.id
            ? lane.length - 7
            : !v.laneChange &&
                !permitsRoute(this.network, lane, v.route[v.routeIndex + 1])
              ? lane.length - LANE_CHANGE.junctionMargin - LANE_CHANGE.distance
              : lane.length;
        if (!permitted) {
          const stopGap = stopAt - v.s + v.safetyGap;
          if (stopGap < gap) {
            gap = stopGap;
            closing = v.speed;
          }
        }
        cap = Math.min(cap, stopAt);
        let target = Math.min(
          v.trip.targetSpeed,
          this.network.roads.get(lane.roadId)!.speedLimit,
        );
        if (permitted) {
          target = Math.min(
            target,
            Math.sqrt(
              plan.speedLimit ** 2 + 2 * v.comfortBrake * (lane.length - v.s),
            ),
          );
          const ahead = this.pathLeader(plan, v, v.s - lane.length);
          const downstreamGap = ahead
            ? lane.length - v.s + ahead.distance - CONFIG.carLength
            : 1e6;
          if (ahead)
            cap = Math.min(cap, lane.length + ahead.distance - CLEAR_DISTANCE);
          if (downstreamGap < gap) {
            gap = downstreamGap;
            closing = v.speed - ahead!.car.speed;
          }
        }
        const acceleration = Math.max(
          -8,
          Math.min(v.maxAccel, idmAccel(v, v.speed, gap, closing, target)),
        );
        let speed = Math.max(0, v.speed + acceleration * dt);
        let s = Math.min(cap, v.s + (v.speed + speed) * 0.5 * dt);
        if (s < v.s) s = v.s;
        if (s >= cap - 1e-8 && !(permitted && cap === lane.length)) speed = 0;
        v.acceleration = acceleration;
        next.set(v.id, { s, speed });
        if (!leader && !v.laneChange && permitted && s >= lane.length - 1e-8)
          entrants.push(v);
      }
    }
    for (const [id, p] of next) {
      const v = this.vehicles.get(id)!;
      v.s = p.s;
      v.speed = p.speed;
      if (v.speed < 0.3) v.waitingTime += dt;
      const lane = this.network.lanes.get(v.laneId)!;
      if (v.laneChange) {
        const change = v.laneChange,
          target = this.network.lanes.get(change.toLaneId)!;
        v.pose = laneChangePose(
          lane,
          target,
          v.s,
          change.startS,
          change.length,
        );
        if (v.s >= change.startS + change.length - 1e-8) {
          v.laneId = target.id;
          v.laneChange = undefined;
          v.lastLaneChangeAt = this.time;
        }
      } else v.pose = this.lanePose(lane, v.s);
      if (this.atArrivalLane(v) && v.arrival!.entryS - v.s < 0.08 && v.speed < 0.15 &&
        !this.accessBusy(v.arrival!.accessId, id) && this.arrivalLaneClear(v)) {
        v.s = v.arrival!.entryS;
        v.arrival!.progress = 0;
        v.speed = 0;
        v.pose = curvePoint(v.arrival!.points, 0);
        this.releaseReservation(id);
      }
      const service = this.serviceJourneys.get(id);
      if (
        service?.stopLaneId === v.laneId &&
        !service.arrived &&
        lane.length - 7 - v.s < 0.08 &&
        v.speed < 0.15
      ) {
        service.arrived = true;
        v.speed = 0;
        this.releaseReservation(id);
      }
    }
    entrants.sort((a, b) => a.trip.departAt - b.trip.departAt || a.id - b.id);
    for (const v of entrants) {
      const lane = this.network.lanes.get(v.laneId)!;
      const node = this.network.nodes.get(lane.to)!;
      const phase = signalPhase(node.signal, this.time);
      const plan = this.movementReservations.get(v.id);
      if (!plan || phase !== `${lane.axis}-green`) continue;
      v.s = lane.length;
      v.crossing = { ...plan, distance: 0, progress: 0 };
      v.pose = crossingPose(v.crossing, 0);
      this.events.push({
        time: this.time,
        vehicle: v.id,
        node: node.id,
        phase,
        type: "enter",
        fromLaneId: lane.id,
        nextLaneId: plan.nextLaneId,
        entrySpeed: v.speed,
      });
    }
    if (this.ticks % 50 === 0) {
      const stats = this.stats;
      this.history.push({
        time: this.time,
        stopped: stats.stopped,
        arrived: stats.arrived,
      });
    }
  }
}
