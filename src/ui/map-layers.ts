import { icon } from "./icons";
import {
  ACCESS_BANDS,
  WASTE_COLOR_STOPS,
  STOCK_BANDS,
  cssColor,
} from "../renderer/map-data";

export const layerNames = {
  water: "수질 · 가상 오염도",
  normal: "일반 도시",
  land: "지구·공터",
  traffic: "교통 혼잡도",
  waste: "쓰레기 수거 상태",
  stock: "상점 재고·물자 공급",
  population: "인구·시설 분포",
  access: "공공시설 접근성",
  environment: "환경 부담 · 가상",
};
const swatch = (color: number, label: string) =>
  `<span><i style="background:${cssColor(color)}"></i>${label}</span>`;
export const mapTools = `<div class="map-tools" aria-label="지도 보기">
  <div class="map-layer-buttons" role="group" aria-label="한 가지 지도 자료 보기">
    ${(
      [
        ["land", "지구·공터", "home"],
        ["traffic", "혼잡도", "layers"],
        ["waste", "쓰레기", "waste"],
        ["water", "수질", "water"],
        ["stock", "상품 재고", "goods"],
        ["access", "시설 접근성", "library"],
        ["environment", "환경 부담", "park"],
        ["population", "인구·시설", "residents"],
      ] as const
    )
      .map(
        ([layer, name, glyph]) =>
          `<button id="${layer === "traffic" ? "overlay" : `layer-${layer}`}" class="map-layer" data-map-layer="${layer}" aria-pressed="false" aria-controls="overlay-legend" title="${name} 보기 · 다시 누르면 일반 도시">${icon(glyph, 18)}<span>${name}</span></button>`,
      )
      .join("")}
  </div>
  <div id="overlay-legend" class="legend" hidden>
    <div data-layer-legend="water" hidden><strong>물에 섞인 오염 <small>가상 오염도</small></strong><div class="legend-swatches">${swatch(0x72b8c5, "낮음")}${swatch(0x9aa76b, "보통")}${swatch(0x8d6853, "높음")}</div><p>상류 → 하류 · 봉투는 물 위 쓰레기<br>색만으로 실제 수질을 알 수는 없어요.</p></div>
    <div data-layer-legend="land" hidden><strong>지구와 건설 공터</strong><div class="legend-swatches">${swatch(0xb8cba9, "주거")}${swatch(0xd2ceb7, "상업")}${swatch(0xbdc4c2, "산업")}</div><p>새봄천과 다리로 이어진 도시예요.<br>A~F 공터를 눌러 면적과 시설을 비교해요.<br>한 공터에는 한 시설만 지을 수 있어요.</p></div>
    <div data-layer-legend="stock" hidden><strong>상점에 남은 물건</strong><div class="legend-swatches access-swatches">${[
      ...STOCK_BANDS,
    ]
      .reverse()
      .map((b) => swatch(b.color, b.label))
      .join(
        "",
      )}</div><p>상점 4곳의 재고예요.<br>차에 실린 물건은 아직 포함하지 않아요.<br>입구의 숫자: 배송을 기다리는 물자</p></div>
    <div data-layer-legend="traffic" hidden><strong>도로 혼잡도</strong><div class="legend-swatches">${swatch(0x659e88, "원활")}${swatch(0xceb66d, "느림")}${swatch(0xc87763, "막힘")}</div></div>
    <div data-layer-legend="waste" hidden><strong>남은 쓰레기 <small>봉투</small></strong><div class="waste-gradient" style="background:linear-gradient(90deg,${WASTE_COLOR_STOPS.map(cssColor).join(",")})"></div><div class="gradient-ticks"><span>0</span><span>20</span><span>40</span><span>60+</span></div><p>진할수록 많이 쌓였어요.<br>수거하는 6곳만 색이 바뀌어요.</p></div>
    <div data-layer-legend="access" hidden>
      <div class="access-service-tabs" role="group" aria-label="접근성을 볼 시설"><button data-access-service="library" aria-pressed="true">${icon("library", 16)}도서관</button><button data-access-service="park" aria-pressed="false">${icon("park", 16)}공원</button></div>
      <strong>걸어서 얼마나 걸릴까요?</strong><div class="legend-swatches access-swatches">${ACCESS_BANDS.map((b) => swatch(b.color, b.label)).join("")}</div>
      <p><i class="coverage-key"></i>테두리 길: 예상 도보 5분 범위<br>건물 색: 주거지의 예상 시간<br>인원: 이용 가능 / 필요한 주민</p>
    </div>
    <div data-layer-legend="environment" hidden><strong>환경 부담 <small>가상 점수</small></strong><div class="legend-swatches">${swatch(0x7bab80, "낮음")}${swatch(0xe1bd6c, "중간")}${swatch(0xc77758, "높음")}</div><p>동네별 색과 숫자를 살펴봐요.</p></div>
    <div data-layer-legend="population" hidden><strong>인구·시설 분포</strong><p>거주 인구와 시설 이용 인구예요.<br>이 도시에서 정한 가상 인구예요.</p></div>
  </div>
</div>`;
