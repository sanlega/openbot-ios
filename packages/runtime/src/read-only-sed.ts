/**
 * `sed -n '1,5p' f` and `sed 's/a/b/g' f` only read; `-i`, `w file` and `e` write files or run
 * programs. A script is accepted only in the two plain shapes below, with no `;` or newline.
 */
export function isReadOnlySed(args: string[]): boolean {
  const risky = args.some(
    (w) =>
      /^-[a-zA-Z]*i/.test(w) ||
      w === "--in-place" ||
      /^--(file|expression|debug|sandbox)/.test(w) ||
      /^-[a-zA-Z]*[fe]/.test(w),
  );
  if (risky) return false;
  const words = args.filter(
    (w) => !/^-[nEr]+$/.test(w) && !/^--(quiet|silent|regexp-extended)$/.test(w),
  );
  const script = (words[0] ?? "").replace(/^(['"])(.*)\1$/, "$2");
  if (/[;\n]/.test(script)) return false;
  const print = /^(\d+(,\d+)?|\$|\/[^/]*\/)?p$/;
  // s<d>pattern<d>replacement<d>flags, where the flags can't include w (write) or e (execute).
  const substitute = /^s(.).*\1.*\1[gpiI0-9]*$/;
  return print.test(script) || substitute.test(script);
}
