import { DAO_PATHS } from "@/lib/daoPaths";
import DaoPathClient from "./DaoPathClient";

export function generateStaticParams() {
  return DAO_PATHS.map((path) => ({ slug: path.slug }));
}

export default async function DaoPathPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <DaoPathClient slug={slug} />;
}
