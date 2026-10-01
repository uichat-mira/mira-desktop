import CoverageReportView from "../../components/CoverageReportView";

export default function DevelopmentClientTests() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <CoverageReportView type="client" />
    </div>
  );
}
