# 台北市非營利幼兒園抽籤率視覺化

給每年春天在台北市幼兒園抽籤系統前深呼吸的家長：這是一個 Angular 21 + Angular Material 網站，會把 `data.json` 轉成可搜尋、可視覺化的台北市非營利幼兒園抽籤參考資料。它不能讓孩子瞬間錄取，但至少能讓焦慮有張表，不必只靠群組裡的都市傳說取暖。

線上網站：<https://pick.pylot.space/>

## 功能

- 以模糊關鍵字搜尋園所，例如輸入「蘭州」即可找到相關結果；不用在深夜把每個園名背得像考公職。
- 支援「臺 / 台」字詞正規化，因為抽不到已經夠痛了，不需要再被異體字補刀。
- 顯示各園所、班別與年齡組的估計中籤率，讓希望與現實用進度條禮貌對視。
- 同時列出「正取」與「備取」人數，方便家長衡量要祈禱、備案，還是先去泡一杯冷掉的咖啡。

估計中籤率公式：

```text
正取 / (正取 + 備取)
```

> 注意：這是以正取與備取名額推得的參考比例，不是官方錄取率。它會誠實呈現殘酷，但不負責安撫台北租金與育兒焦慮聯手製造的心悸。

## 開發指令

安裝依賴：

```bash
npm install
```

啟動本機開發伺服器：

```bash
npm start
```

開啟 <http://localhost:4200/>。

建置正式版：

```bash
npm run build
```

輸出會產生在 `dist/picked-again/browser/`。

建置 GitHub Pages 版本（給自訂網域 `https://pick.pylot.space/` 使用，base href 為 `/`）：

```bash
npm run build:pages
```

GitHub Actions 會在推送或手動觸發 `main` 時執行測試、建置，並把
`dist/picked-again/browser/` 部署到 GitHub Pages；`public/CNAME` 會一併輸出成 Pages
自訂網域設定檔。PR 只會測試與建置，不會部署。

Bundle inspection（本機分析用；不會改變一般部署建置，也不讓 `build` / `build:pages`
輸出 source maps）：

```bash
npm run bundle:build    # production build with source maps for inspection only
npm run bundle:list     # list JS bundles in dist/picked-again/browser/
npm run bundle:analyze  # source-map-explorer JSON output for the main bundle
npm run bundle:report   # HTML report at dist/picked-again/browser/main-bundle-report.html
```

`bundle:build` 會在 `dist/picked-again/browser/` 產生 `.map` 檔供
`source-map-explorer` 讀取；這些輸出位於已忽略的 `dist/`，只適合本機或 CI 檢查。

`public/_headers` 會隨建置輸出，為支援該檔案格式的靜態主機或 CDN 設定快取：
content-hashed Angular JS/CSS bundles 使用長效 immutable 快取，`/`、`/index.html`
與 `/assets/data.json` 維持短效可重新驗證。GitHub Pages 不會套用 `_headers`，若要在線上
`pick.pylot.space` 實際送出這些 Cache-Control headers，仍需在 Cloudflare 等邊緣層設定快取規則，
或改由會讀取 `_headers` 的相容靜態主機提供服務。

執行單元測試：

```bash
npm test -- --watch=false
```

## Cloudflare Worker Data Sync

`workers/kindergarten-sync` 是獨立的 Cloudflare Worker 子專案。正式上線後由 Worker Cron 每 3 分鐘同步臺北市公立與非營利幼兒園資料，並把最新 JSON 存到 Cloudflare KV；GitHub Actions 只負責部署 Worker，不會新增每 3 分鐘修改 repo 的 workflow。

- KV keys：
  - `kindergarten:lottery-history`：113/114 學年度歷史抽籤資料，來源為 `public/assets/data.json`。
  - `kindergarten:latest`：Worker Cron 每 3 分鐘同步的最新 115 學年度招生資料，供即時 API 使用。
- API endpoints：
  - `GET /health`
  - `GET /kindergarten/lottery-data`：前端使用的合併資料，包含 `kindergarten:lottery-history` 的 113/114 學年度與 `kindergarten:latest` 轉換出的 115 學年度。
  - `GET /kindergarten/latest`
  - `GET /kindergarten/public`
  - `GET /kindergarten/non-profit`
  - `POST /kindergarten/sync`
- 初始匯入 KV：

  ```bash
  cd workers/kindergarten-sync
  npm run kv:init
  ```

- 部署 Worker：

  ```bash
  cd workers/kindergarten-sync
  npm install
  npm run deploy
  ```

- Secrets 與環境設定：
  - GitHub Actions 需要設定 `CLOUDFLARE_API_TOKEN` repository secret，供 `.github/workflows/deploy-worker.yml` 部署 Worker。
  - 手動同步 endpoint 需要 Worker secret：

    ```bash
    cd workers/kindergarten-sync
    npx wrangler secret put SYNC_SECRET
    ```

  - CORS 允許來源由 `ALLOWED_ORIGINS` 設定，格式為逗號分隔的 origin，例如 `https://pick.pylot.space,https://willseed.github.io,http://localhost:4200`。

`workers/kindergarten-sync/wrangler.jsonc` 會把 `KINDERGARTEN_KV` 綁定到 production KV namespace；部署 workflow 會接著執行 `npm run kv:init`，把 `public/assets/data.json` seed 到 `kindergarten:lottery-history`。Cron sync 只更新 `kindergarten:latest`，不會覆蓋 113/114 學年度歷史抽籤資料；`/kindergarten/lottery-data` 會在回應時把 113/114 與 115 合併。若改用不同 KV，請同步更新 namespace id。

## 資料與限制

- 執行時資料來自 `public/assets/data.json`；根目錄的 `data.json` 目前鏡像同一份來源資料。
- 園所資料可用 `搜尋關鍵字` 補行政區或別名，例如蘭州非營利幼兒園掛上「大同區」，讓家長不必先抽中記憶力才能查到園所。
- 顯示的估計中籤率只供比較與查詢，不構成任何錄取承諾。它不是保母、不是神明，也不是教育局的秘密後台。
- 若資料與官方公告不同，請以台北市政府教育局、各園所或相關官方公告為準。

## 免責聲明

本專案內容僅供參考，不代表實際錄取結果，也不保證任何報名或錄取結果。願每位台北家長都能在抽籤頁面轉圈圈時保有一點幽默感，並記得最終資訊請以官方公告為準。
