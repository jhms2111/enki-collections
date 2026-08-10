import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function DemoAccessPage() {
  permanentRedirect("/demo/jf-demo");
}
