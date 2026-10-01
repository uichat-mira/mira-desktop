import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle } from "lucide-react";
import { Result } from "@/shared/ui";
import { useAuth } from "@/app/providers/AuthProvider";
import AppPageLayout from "@/app/Layouts/AppPageLayout";
import { getDashboardMail, getDashboardNews, getDashboardOverview, getDashboardWeather } from "./api/dashboard-api";
import { WidgetCard } from "./components/WidgetCard";
import { DashboardGreeting } from "./components/DashboardGreeting";
import { InsightPlaceholder } from "./components/InsightPlaceholder";
import { WidgetGrid } from "./components/WidgetGrid";
import { dashboardWidgetRegistry } from "./registry/dashboard-widget-registry";
import { isDashboardWidgetType, type ClockWeatherData, type DashboardOverview, type MailData, type NewsData } from "./types/dashboard-types";

const createWeatherData = (status: ClockWeatherData["status"], now = new Date()): ClockWeatherData => ({
  demo: false,
  sourceLabel: "IP 定位 + Open-Meteo",
  status,
  localTime: now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
  dateLabel: now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }),
  locationLabel: status === "loading" ? "正在定位" : "位置不可用",
  weatherAvailable: false,
  weatherCode: null,
  isDay: null,
  weather: status === "loading" ? "天气加载中" : "天气不可用",
  temperature: "--",
  forecast: status === "loading" ? "正在获取当前位置天气" : "暂时无法获取天气数据",
});

function DashboardLoadingSkeleton() {
  const placements: Record<string, string> = {
    time: "md:col-start-1 md:row-start-1",
    news: "md:col-start-2 md:row-start-1",
    mail: "order-4 md:col-start-2 md:row-start-2",
  };

  return (
    <WidgetGrid>
      {["time", "news", "mail"].map((key) => (
        <article key={key} className={`flex min-h-[220px] min-w-0 flex-col rounded-ui-panel border border-border bg-surface-primary shadow-shadow-sm ${placements[key]}`} aria-label="工作台加载中">
          <div className="border-b border-border px-4 py-3"><div className="h-4 w-20 animate-pulse rounded-sm bg-surface-secondary" /></div>
          <div className="flex flex-1 flex-col gap-4 p-4">
            <div className="h-5 w-2/5 animate-pulse rounded-sm bg-surface-secondary" />
            <div className="h-4 w-full animate-pulse rounded-sm bg-surface-secondary" />
            <div className="h-4 w-4/5 animate-pulse rounded-sm bg-surface-secondary" />
          </div>
          <div className="border-t border-border px-4 py-2"><div className="h-3 w-14 animate-pulse rounded-sm bg-surface-secondary" /></div>
        </article>
      ))}
      <InsightPlaceholder />
    </WidgetGrid>
  );
}

export default function DashboardPage() {
  const { i18n } = useTranslation();
  const { session } = useAuth();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weatherData, setWeatherData] = useState<ClockWeatherData | null>(null);
  const [newsData, setNewsData] = useState<NewsData | null>(null);
  const [mailData, setMailData] = useState<MailData | null>(null);

  useEffect(() => {
    let disposed = false;
    void getDashboardOverview()
      .then((data) => {
        if (!disposed) setOverview(data);
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : "工作台数据加载失败");
      });
    void getDashboardWeather()
      .then((data) => {
        if (!disposed) setWeatherData(data);
      })
      .catch(() => {
        if (!disposed) setWeatherData(createWeatherData("unavailable"));
      });
    void getDashboardNews(i18n.language)
      .then((data) => {
        if (!disposed) setNewsData(data);
      })
      .catch(() => undefined);
    void getDashboardMail(i18n.language)
      .then((data) => {
        if (!disposed) setMailData(data);
      })
      .catch(() => {
        if (!disposed) setMailData({ demo: false, sourceLabel: "邮件中心", status: "unavailable", totalToday: 0, attentionCount: 0, items: [] });
      });
    return () => {
      disposed = true;
    };
  }, [i18n.language]);

  return (
    <AppPageLayout
      miniTitle="Mira"
      title="Mira 工作台"
      description="你的智能助手，随时为你掌握全局"
      contentMode="flow"
      contentClassName="pt-5 xl:pt-6"
    >
      <div className="space-y-3">
        <DashboardGreeting username={session?.user.username || "朋友"} newsCount={newsData?.items.length ?? 0} mailCount={mailData?.attentionCount ?? 0} />
        {error ? <div className="rounded-ui-panel border border-danger-border bg-danger-soft"><Result title="工作台暂时无法加载" description={error} variant="danger" size="sm" icon={<AlertCircle className="h-5 w-5" />} /></div> : overview ? <WidgetGrid>{overview.widgets.map((widget) => { const Renderer = isDashboardWidgetType(widget.type) ? dashboardWidgetRegistry[widget.type] : null; const resolvedWidget = widget.type === "clock-weather" && weatherData ? { ...widget, data: weatherData } : widget.type === "news" && newsData ? { ...widget, data: newsData } : widget.type === "mail" && mailData ? { ...widget, data: mailData } : widget; return Renderer ? <Renderer key={widget.id} widget={resolvedWidget} /> : <WidgetCard key={widget.id} widget={resolvedWidget} state="error" error="暂不支持此 Widget 类型" />; })}<InsightPlaceholder /></WidgetGrid> : <DashboardLoadingSkeleton />}
      </div>
    </AppPageLayout>
  );
}
