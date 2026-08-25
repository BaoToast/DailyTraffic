import { getChatGPTUser } from "./chatgpt-auth";
import DashboardClient from "./DashboardClient";
import ErrorBoundary from "./ErrorBoundary";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  // 錯誤邊界一定要包在最外層：沒有它，一筆形狀不對的既存資料就會讓整個
  // 畫面變成全白，而且重新整理之後還是全白，使用者的資料等於再也打不開。
  return (
    <ErrorBoundary>
      <DashboardClient user={user ? { displayName: user.displayName, email: user.email } : null} />
    </ErrorBoundary>
  );
}
