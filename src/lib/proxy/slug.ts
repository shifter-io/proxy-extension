/**
 * Normalizes a location label into a gateway slug, same rules as the API's
 * geo lists: accents become plain letters, everything is lowercase, and each
 * run of other characters becomes one `_`.
 *
 *   "São Paulo" -> "sao_paulo", "Île-de-France" -> "ile_de_france", "St. John's" -> "st_john_s"
 *
 * The live geo lists already return slugs; this is for the mock catalog.
 */
export function slugify(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
