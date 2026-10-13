import "./styles.css";

// Keep the loading view usable while the independently cached 3D code loads.
void import("./main").catch((error: unknown) => {
  console.error(error);
  if (document.querySelector(".webgl-error")) return;
  document.querySelector("#app")!.innerHTML =
    '<main class="startup-screen"><h1>도시를 열지 못했어요</h1><p>새로고침해서 다시 시작해 주세요.</p><button id="retry-startup" class="primary">다시 열기</button></main>';
  document
    .querySelector("#retry-startup")!
    .addEventListener("click", () => location.reload());
});
