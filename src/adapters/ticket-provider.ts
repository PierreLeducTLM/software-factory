export type Ticket = {
  readonly key: string;
  readonly title: string;
  readonly status: string;
  readonly labels: readonly string[];
  readonly repository: string;
  readonly spec?: string;
  readonly factoryComment?: string;
  readonly updatedAt: string;
  readonly statusSince: string;
};

export type TransitionRequest = { readonly key: string; readonly from: string; readonly to: string };

export type TransitionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'not_in_expected_status'; readonly actual: string };

export type AttachmentRequest = { readonly key: string; readonly name: string; readonly content: string };

export type Attachment = { readonly name: string; readonly link: string };

export type TicketSearch = {
  readonly statuses?: readonly string[];
  readonly label?: string;
  readonly updatedSince?: string;
};

export type ProviderStatus = { readonly name: string; readonly category: 'todo' | 'in_progress' | 'done' | 'unknown' };

export type Access = { readonly comment: boolean; readonly transition: boolean };

export interface TicketProvider {
  getTicket(key: string): Promise<Ticket | undefined>;
  transition(request: TransitionRequest): Promise<TransitionResult>;
  getFactoryComment(key: string): Promise<string | undefined>;
  putFactoryComment(key: string, body: string): Promise<void>;
  addAttachment(request: AttachmentRequest): Promise<string>;
  listAttachments(key: string): Promise<readonly Attachment[]>;
  readAttachment(link: string): Promise<string>;
  search(criteria: TicketSearch): Promise<readonly Ticket[]>;
  listStatuses(): Promise<readonly ProviderStatus[]>;
  checkAccess(key: string): Promise<Access>;
}
