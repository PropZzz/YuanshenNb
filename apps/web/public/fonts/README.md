# V1 视觉参考字体

这些字体原样复用于仓库 `main:web/stitch/assets/fonts/`，与 V1 的字体声明一致。没有迁入旧版脚本或页面。

| 文件 | 参考字体声明 |
| --- | --- |
| bad5f68b18b9.ttf | Inter 400 |
| 11e1d80f42f9.ttf | Inter 500 |
| e9191f0db3ed.ttf | Inter 600 |
| 1be3d765b0bd.ttf | Inter 700 |
| 12116428bc46.ttf | Noto Serif 600 |
| 9a7592e4e65a.ttf | Noto Serif 700 |
| 3dd13e76612a.ttf | Material Symbols Outlined 500，原版图标字形 |

`main-reference.css` 来源为同目录下的 `12238e2340c3.css`。字体以 `font-display: swap` 加载；中文继续使用设计令牌声明的本地字体后备。

`src/styles/reference.css` 声明原版 Material Symbols 字体。`src/components/ui/reference-icons.tsx` 的 SVG 路径从同一字体抽取，保持旧组件的尺寸和无障碍接口，同时匹配原版图标轮廓；不是另一套图标的近似替代。来源为 main 分支保留的 Google Material Symbols 字体资源。
