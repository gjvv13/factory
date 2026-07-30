export interface InboundMessage {
  /** Naam van het kanaal waarover het bericht binnenkwam, bijv. 'http' of 'whatsapp'. */
  readonly channel: string;
  /** Kanaalspecifieke identificatie van de afzender (telefoonnummer, chat-id). */
  readonly from: string;
  readonly text: string;
  readonly receivedAt: Date;
}

export interface OutboundMessage {
  readonly channel: string;
  readonly to: string;
  readonly text: string;
}
