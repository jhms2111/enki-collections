import type { AuthorizedOffer } from "@/modules/debt-provider/debt-provider.types";

export type OfferPresentation = Readonly<{
  publicText: string;
  replayMarker: string;
}>;

export interface OfferPresentationPolicy {
  present(offer: AuthorizedOffer): OfferPresentation | null;
}
