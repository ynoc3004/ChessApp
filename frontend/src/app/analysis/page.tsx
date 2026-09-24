import AnalysisClient from "./AnalysisClient";

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ image?: string | string[] }>;
}) {
  const params = await searchParams;
  const image = Array.isArray(params.image) ? params.image[0] : params.image;
  return <AnalysisClient imageUrl={image ?? ""} />;
}
