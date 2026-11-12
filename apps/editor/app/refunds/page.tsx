import { PlatformLegalPage } from "../../components/PlatformLegalPage";

export const metadata = { title: "Refund and Cancellation Policy" };
export const dynamic = "force-static";

export default function Page() {
  return <PlatformLegalPage kind="refunds" />;
}
