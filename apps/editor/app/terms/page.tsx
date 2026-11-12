import { PlatformLegalPage } from "../../components/PlatformLegalPage";

export const metadata = { title: "Terms of Service" };
export const dynamic = "force-static";

export default function Page() {
  return <PlatformLegalPage kind="terms" />;
}
