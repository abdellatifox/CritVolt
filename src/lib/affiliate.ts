/**
 * Central affiliate layer.
 *
 * Every outbound money link in the site goes through `affiliateUrl()`.
 * Why: when you switch programme, change your tracking tag, or need to add a
 * sub-id for attribution, you edit ONE file instead of hundreds of articles.
 *
 * Compliance: outbound monetised links must carry rel="sponsored nofollow".
 * Google treats undisclosed paid links as a link-scheme violation.
 */

export type Network = 'amazon' | 'awin' | 'impact' | 'direct';

/** Your tracking IDs. Replace the placeholders before going live. */
export const AFFILIATE_IDS: Record<Network, string | null> = {
  amazon: 'critvolt-20', // Amazon Associates tag
  awin: '0000000',      // Awin publisher ID
  impact: '0000000',    // Impact partner ID
  direct: null,         // Unmonetised / editorial link
};

/** Query-parameter name each network expects. */
const PARAM: Record<Network, string | null> = {
  amazon: 'tag',
  awin: 'awinaffid',
  impact: 'irclickid',
  direct: null,
};

export const AFFILIATE_REL = 'sponsored nofollow noopener';

/**
 * Build a tracked outbound URL.
 * @param url      Raw product URL from the retailer.
 * @param network  Affiliate programme the retailer belongs to.
 * @param subId    Optional attribution slug (usually the article slug) so you can
 *                 see which post earns. Highly recommended.
 */
export function affiliateUrl(url: string, network: Network = 'amazon', subId?: string): string {
  const id = AFFILIATE_IDS[network];
  const param = PARAM[network];
  if (!id || !param) return url;

  try {
    const u = new URL(url);
    u.searchParams.set(param, id);
    if (subId) u.searchParams.set('ascsubtag', subId);
    return u.toString();
  } catch {
    // Malformed URL — fail open rather than breaking the page.
    return url;
  }
}

/** Attributes to spread onto any monetised <a>. Keeps rel/target consistent. */
export function affiliateAttrs(network: Network = 'amazon') {
  return {
    rel: network === 'direct' ? 'noopener' : AFFILIATE_REL,
    target: '_blank',
    'data-affiliate': network,
  };
}
