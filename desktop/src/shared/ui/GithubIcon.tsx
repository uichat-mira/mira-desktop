import type { SVGProps } from "react";

/**
 * GitHub 官方图标（Octicons `mark-github`）。
 *
 * lucide-react 从品牌图标策略调整起已移除了 `Github` 这个 named export，
 * 而项目原本从这里按 named import 引用它，导致 dev 启动时 ESM 解析直接抛
 * `SyntaxError: does not provide an export named 'Github'` 并让整个 renderer 崩溃。
 *
 * 这里用官方 Octicons 的 SVG path 内联实现，零新依赖、不改动 lucide-react 版本，
 * 对外暴露的组件名仍为 `Github`，调用点（<Github className="..."/>）无需改动。
 */
const Github = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    {...props}
  >
    {/*
     * Octicons `mark-github` 原生 path 在 16×16 画布里几乎撑满，
     * 直接用同样的 className（如 h-7 w-7）会比同位置 lucide 图标
     * （Boxes / Image 等，其 path 在 24×24 画布里只占中心）视觉上大
     * 一圈。把 path 嵌入 24×24 的 viewBox、并用 translate(4 4)
     * 居中（(24-16)/2=4），就能让两边观感对齐，而不必动任何调用点。
     */}
    <g transform="translate(4 4)">
      <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
    </g>
  </svg>
);

export default Github;
