import guideHtml from '../../../docs/starjar-user-guide.html?raw';

export default function UserGuide() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-800">使用說明</h1>
        <p className="text-sm text-slate-500">StarJar 功能與操作指南</p>
      </div>
      <iframe
        title="StarJar 使用說明書"
        srcDoc={guideHtml}
        className="h-[calc(100vh-190px)] min-h-[680px] w-full rounded-2xl border border-slate-200 bg-white shadow-sm"
      />
    </div>
  );
}
