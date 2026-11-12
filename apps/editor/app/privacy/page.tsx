import { PlatformLegalPage } from "../../components/PlatformLegalPage";

export const metadata = { title: "Privacy Policy" };
export const dynamic = "force-static";

export default function Page() {
  return <PlatformLegalPage kind="privacy" />;
}
