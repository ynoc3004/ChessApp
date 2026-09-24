import AnalysisClient from "./AnalysisClient";

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{
    image?: string | string[];
    job?: string | string[];
    position?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const image = Array.isArray(params.image) ? params.image[0] : params.image;
  const job = Array.isArray(params.job) ? params.job[0] : params.job;
  const positionRaw = Array.isArray(params.position) ? params.position[0] : params.position;
  const positionId = positionRaw ? Number(positionRaw) : 0;

  return (
    <AnalysisClient
      imageUrl={image ?? ""}
      jobId={job ?? ""}
      positionId={Number.isFinite(positionId) ? positionId : 0}
    />
  );
}
