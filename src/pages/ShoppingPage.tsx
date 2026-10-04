// ---------- src/pages/ShoppingPage.tsx ----------
export default function ShoppingPage() {
  return <Placeholder icon="🛒" title="買い物リスト" />
}
function Placeholder({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex flex-col items-center justify-center pt-32 text-gray-400">
      <div className="text-5xl">{icon}</div>
      <p className="mt-3 font-bold">{title}</p>
      <p className="text-xs">準備中</p>
    </div>
  )
}