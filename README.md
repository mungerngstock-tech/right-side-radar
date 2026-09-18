# 右側雷達（Right-Side Radar）

同時監察五隻美股的日內價量右側分析工具。它把「右側條件是否完成」與「歷史相似形態的方向概率」分開呈現，避免把規則分數誤當成上漲機率。

- 線上版本：[rightside-five-stock-radar.maple-bow-0481.chatgpt.site](https://rightside-five-stock-radar.maple-bow-0481.chatgpt.site/)
- 完整設計：[docs/DESIGN.md](docs/DESIGN.md)
- 預設觀察：MRVL、AVGO、NVDA、CRDO、LITE

## 核心功能

- 同畫面觀察 5 隻股票
- 1 分鐘／5 分鐘 K 線
- 價格、成交量、EMA 9、EMA 20、VWAP、ATR 與相對成交量
- 六項右側確認條件、假突破與放量滯漲警示
- 上漲／橫行／下跌三向概率、樣本數與預期波幅
- 只用完整收盤 K 線確認訊號
- 行情每 30 秒更新；概率每 5 分鐘重算
- 免費 Yahoo Finance 公開圖表資料，不需 API Key

## 概率與條件分數不是同一件事

- **右側條件分數**回答：目前結構是否完成。
- **歷史方向概率**回答：同一股票過去出現相似價量片段後，向上、橫行與向下各佔多少。

例如「3/6 條件成立」不等於「50% 上漲概率」。

## 技術架構

- React 19 + TypeScript
- Next 16 相容路由／Vinext
- Cloudflare Worker 執行環境
- Tailwind CSS + shadcn UI + Recharts
- 伺服器 API：
  - `/api/market`：當日行情與成交量
  - `/api/probability`：歷史相似片段方向概率

## 本機執行

需求：Node.js 22.13 以上及 pnpm。

```bash
pnpm install
pnpm dev
```

正式建置：

```bash
pnpm build
pnpm start
```

## 備份與重新部署

此 repository 是完整原始碼備份。GitHub Pages 只能託管靜態檔案，不能執行本專案的兩個伺服器 API，因此不能單獨提供等效的即時行情與概率功能。

若要建立真正獨立的第二個線上站點，請把此 repository 部署至支援 Node／Worker API 的平台，例如 Cloudflare Workers、Vercel 或其他支援 Next.js API routes 的服務。

## 重要限制

- Yahoo Finance 公開端點可能延遲、限流、缺值或改變格式。
- 方向概率是歷史相似樣本統計，不是保證或校準後的交易勝率。
- 工具不包含新聞、財報、Level 2、期權定位、滑價與交易成本。
- 本工具只供研究與教育用途，不構成投資建議。
