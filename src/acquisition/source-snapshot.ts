/** Browser HTML stays local; preserve distinct discovery text, not duplicate copies of the JD. */
export function compactSourceSnapshot<T>(snapshot: T): T {
  const copy = JSON.parse(
    JSON.stringify(snapshot, (key, value) => {
      if (
        /^(cookies?|authorization|password|accessToken|refreshToken|sessionToken|storageState)$/i.test(
          key,
        )
      ) {
        throw new Error("ACQUISITION_SESSION_MATERIAL_REJECTED");
      }
      return key === "rawHtml" ? undefined : value;
    }),
  );
  const sourceText = copy.detail?.rawText;
  if (sourceText) {
    if (copy.rawText === sourceText) delete copy.rawText;
    if (copy.card?.rawText === sourceText) delete copy.card.rawText;
  }
  return copy;
}
