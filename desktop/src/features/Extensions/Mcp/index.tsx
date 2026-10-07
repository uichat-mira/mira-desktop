import {
  Boxes,
  ChevronRight,
  LibraryBig,
  Mail,
  MousePointerClick,
  Newspaper,
  Search,
} from "lucide-react";
import { useMemo, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import AppPageLayout from "@/app/Layouts/AppPageLayout";
import {
  Button,
  Card,
  GithubIcon,
  IconButton,
  NotionIcon,
  Result,
  TextInput,
} from "@/shared/ui";

type PrototypeStatusTone = "success" | "warning" | "muted";

type PrototypeIntegrationKind = "built-in" | "custom";

type PrototypeCapabilityFilter = "all" | PrototypeIntegrationKind;

type PrototypeIntegrationCard = {
  id: string;
  name: string;
  description: string;
  source: string;
  status: string;
  statusTone: PrototypeStatusTone;
  kind: PrototypeIntegrationKind;
  icon: ComponentType<{ className?: string }>;
  iconClassName: string;
};

const capabilityFilters: Array<{
  id: PrototypeCapabilityFilter;
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "built-in", label: "内置" },
  { id: "custom", label: "自定义" },
];

const prototypeIntegrations: PrototypeIntegrationCard[] = [
  {
    id: "knowledge-base",
    name: "知识库",
    description: "把本地文档接入检索与问答，让每次回答都有据可依。",
    source: "Mira 内置",
    status: "已连接",
    statusTone: "success",
    kind: "built-in",
    icon: LibraryBig,
    iconClassName: "bg-sky-50 text-sky-500",
  },
  {
    id: "github",
    name: "GitHub",
    description: "浏览仓库、读取代码，跟踪 Issue 与 Pull Request。",
    source: "第三方服务",
    status: "未连接",
    statusTone: "muted",
    kind: "custom",
    icon: GithubIcon,
    iconClassName: "bg-slate-100 text-slate-600",
  },
  {
    id: "notion",
    name: "Notion",
    description: "读写页面与数据库，把团队笔记带进对话上下文。",
    source: "第三方服务",
    status: "已连接",
    statusTone: "success",
    kind: "custom",
    icon: NotionIcon,
    iconClassName: "bg-amber-50 text-amber-500",
  },
  {
    id: "mail-center",
    name: "邮件中心",
    description: "收发邮件、检索往来记录，并生成可编辑的回复草稿。",
    source: "Mira 内置",
    status: "需授权",
    statusTone: "warning",
    kind: "built-in",
    icon: Mail,
    iconClassName: "bg-indigo-50 text-indigo-500",
  },
  {
    id: "news-hub",
    name: "观澜",
    description: "汇集多源科技资讯，浏览、检索并生成智能摘要。",
    source: "Mira 内置",
    status: "已连接",
    statusTone: "success",
    kind: "built-in",
    icon: Newspaper,
    iconClassName: "bg-rose-50 text-rose-500",
  },
  {
    id: "touch-realm",
    name: "触界",
    description: "连接当前 Chrome，在本机查看页面、点击、填写与文件操作。",
    source: "本机 Chrome",
    status: "需授权",
    statusTone: "warning",
    kind: "built-in",
    icon: MousePointerClick,
    iconClassName: "bg-teal-50 text-teal-500",
  },
  {
    id: "code-graph",
    name: "CodeGraph",
    description: "理解代码仓结构、定位符号关系，为代码检索与探索提供索引。",
    source: "Mira 内置",
    status: "未连接",
    statusTone: "muted",
    kind: "built-in",
    icon: Boxes,
    iconClassName: "bg-violet-50 text-violet-500",
  },
];

const statusClassName = (tone: PrototypeStatusTone) => {
  if (tone === "success") return "text-success-text";
  if (tone === "warning") return "text-warning-text";
  return "text-text-tertiary";
};

export default function McpPage() {
  const { t } = useTranslation();
  const [activeFilter, setActiveFilter] =
    useState<PrototypeCapabilityFilter>("all");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const visibleIntegrations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return prototypeIntegrations.filter((integration) => {
      const matchesFilter =
        activeFilter === "all" || integration.kind === activeFilter;
      const matchesQuery =
        !normalizedQuery ||
        `${integration.name} ${integration.description} ${integration.source}`
          .toLowerCase()
          .includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [activeFilter, query]);

  return (
    <AppPageLayout
      miniTitle={t("app.navigation.extensions")}
      title={t("app.navigation.mcp")}
      description="连接外部服务与工具，把常用能力接进 Mira。"
      contentClassName="pt-5"
      scrollBody={false}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5">
        <div className="flex min-w-0 shrink-0 items-center gap-3">
          <div className="stable-scrollbar min-w-0 flex-1 overflow-x-auto pb-1">
            <div className="flex gap-1">
              {capabilityFilters.map((filter) => (
                <Button
                  key={filter.id}
                  size="xs"
                  variant={activeFilter === filter.id ? "secondary" : "ghost"}
                  onClick={() => setActiveFilter(filter.id)}
                  className="shrink-0"
                >
                  {filter.label}
                </Button>
              ))}
            </div>
          </div>

          <div
            className={`h-8 shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
              searchOpen ? "w-40" : "w-8"
            }`}
          >
            {searchOpen ? (
              <TextInput
                autoFocus
                ariaLabel="搜索能力"
                compact
                placeholder="搜索能力"
                value={query}
                onChange={setQuery}
                onBlur={() => setSearchOpen(false)}
              />
            ) : (
              <IconButton
                ariaLabel="搜索能力"
                size="sm"
                styleType="filled"
                onClick={() => setSearchOpen(true)}
              >
                <Search size={17} />
              </IconButton>
            )}
          </div>
        </div>

        <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto">
          {visibleIntegrations.length ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {visibleIntegrations.map((integration) => (
                <IntegrationCard
                  key={integration.id}
                  integration={integration}
                />
              ))}
            </div>
          ) : (
            <Result
              size="sm"
              icon={<Search className="h-4 w-4" />}
              title="没有匹配的能力"
              description="试试其他分类或搜索关键词"
            />
          )}
        </div>
      </div>
    </AppPageLayout>
  );
}

function IntegrationCard({
  integration,
}: {
  integration: PrototypeIntegrationCard;
}) {
  const Icon = integration.icon;

  return (
    <Card interactive padding="none" className="min-h-[132px] overflow-hidden">
      <div className="group flex h-full w-full flex-col p-4 text-left">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] ${integration.iconClassName}`}
          >
            <Icon className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h4 className="truncate text-sm font-semibold text-text-primary">
                {integration.name}
              </h4>
              <span
                className={`text-xs ${statusClassName(integration.statusTone)}`}
              >
                · {integration.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-text-tertiary">
              来自 {integration.source}
            </p>
          </div>
          <ChevronRight
            size={17}
            className="text-text-tertiary transition-transform group-hover:translate-x-0.5"
          />
        </div>
        <p className="mt-4 line-clamp-2 text-xs leading-5 text-text-secondary">
          {integration.description}
        </p>
      </div>
    </Card>
  );
}
