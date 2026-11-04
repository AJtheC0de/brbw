function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let mismatch = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index++) {
    mismatch |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return mismatch === 0;
}
export function gatewayRejection(request: Request, allowInternal = false) {
  const expected = Deno.env.get("JOBPLY_GATEWAY_SECRET") || "";
  if (!expected) return null;

  const received = request.headers.get("x-jobply-gateway") || "";
  if (timingSafeEqual(expected, received)) return null;

  if (allowInternal) {
    const internalExpected = Deno.env.get("JOBPLY_INTERNAL_SECRET") || "";
    const internalReceived = request.headers.get("x-jobply-internal") || "";
    if (internalExpected && timingSafeEqual(internalExpected, internalReceived)) return null;
  }

  return Response.json(
    { ok: false, error: "gateway_required" },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
