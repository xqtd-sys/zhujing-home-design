# 家具缩略图目录

放到这里的图片会被前端以 `/furniture/<文件名>` 访问（Vite 的 public 目录，构建后进入 `dist/furniture/`）。

## 命名约定（与数据库 `furniture_assets.name` 对应）

| 家具 | 建议文件名 |
|---|---|
| 沙发 | `sofa.jpg` |
| 床 | `bed.jpg` |
| 餐桌 | `dining-table.jpg` |
| 柜子 | `cabinet.jpg` |

## 要求

- 格式：jpg / png / webp 均可；单张建议 ≤ 300KB。
- 尺寸：建议 400×300 或 1:1，卡片里会 `object-fit: cover`。
- 授权：请使用可商用/CC0 图片（Unsplash、Pexels、Pixabay、Openverse 的 CC0 等）。
- 新增家具时，把图片放这里，并把数据库 `furniture_assets.icon_url` 设为 `/furniture/<文件名>`。

## 自动化抓取（需联网）

```powershell
node scripts/fetch-furniture-images.mjs
```

脚本会从 Openverse（CC0/公共领域）找图、下载到本目录，并打印对应的 SQL。
执行完后把 SQL 跑一遍，或在有网终端跑完后告诉我，我来更新数据库。