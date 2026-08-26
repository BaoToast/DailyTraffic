# GitHub Pages 建置來源

這個資料夾是「全日交通量及車種組成」GitHub Pages 靜態網站的建置入口。

- 執行 `npm run build:pages` 會將網站輸出至 `github-pages/dist/`。
- 執行 `npm run e2e` 會先產生測試樣本、建置網站，再執行瀏覽器操作測試。
- 發布用壓縮包會取自 `github-pages/dist/`，並另外補入 `.nojekyll`、說明文件與版本資料。
