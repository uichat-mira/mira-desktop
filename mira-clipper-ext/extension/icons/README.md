# 触界图标

图标使用 UIChat Mira 安装包的正式品牌 Logo，源文件为仓库根目录 `icons/icon_512.png`。

- `icon-16.png` — 16×16
- `icon-32.png` — 32×32
- `icon-48.png` — 48×48
- `icon-128.png` — 128×128

同尺寸的 `icon-*-attention.png` 在正式图标右下角增加一个小黄色圆点，仅用于待授权状态。工具栏不使用 Chrome Badge，避免出现固定尺寸的方形徽标。

两个 manifest 的 `icons` 与 `action.default_icon` 都引用这组文件。更新品牌 Logo 时必须从同一正式源文件重新生成全部尺寸。

重新生成方式：

```bash
node scripts/generate-clipper-icons.mjs
```

脚本从仓库根目录 `icons/icon_512.png` 读取源图，输出 `icon-16/32/48/128.png` 以及带右下角黄色圆点的 `icon-*-attention.png`；不要手工单独替换某个尺寸。
