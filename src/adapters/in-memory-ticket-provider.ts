import type { Access, ProviderStatus, Ticket, TicketProvider, TicketSearch } from './ticket-provider.js';

type Options = { readonly tickets: readonly Ticket[]; readonly now: () => string; readonly statuses?: readonly ProviderStatus[]; readonly access?: Access };

const FULL_ACCESS: Access = { comment: true, transition: true };

const LINK_PREFIX = 'memory://attachment/';

const matches = (ticket: Ticket, criteria: TicketSearch): boolean =>
  (criteria.statuses === undefined || criteria.statuses.includes(ticket.status)) &&
  (criteria.label === undefined || ticket.labels.includes(criteria.label)) &&
  (criteria.updatedSince === undefined || Date.parse(ticket.updatedAt) > Date.parse(criteria.updatedSince));

export const createInMemoryTicketProvider = ({ tickets, now, statuses, access = FULL_ACCESS }: Options): TicketProvider => {
  const state: { tickets: readonly Ticket[]; attachments: readonly string[]; listed: readonly { key: string; name: string; link: string }[] } = {
    tickets,
    attachments: [],
    listed: [],
  };

  const find = (key: string): Ticket | undefined => state.tickets.find((ticket) => ticket.key === key);

  const replace = (key: string, change: Partial<Ticket>): void => {
    state.tickets = state.tickets.map((ticket) =>
      ticket.key === key ? { ...ticket, ...change, updatedAt: now() } : ticket,
    );
  };

  return {
    getTicket: async (key) => find(key),

    transition: async ({ key, from, to }) => {
      const ticket = find(key);
      if (ticket === undefined) return { ok: false, reason: 'not_found' };
      if (ticket.status !== from) return { ok: false, reason: 'not_in_expected_status', actual: ticket.status };
      replace(key, { status: to, statusSince: now() });
      return { ok: true };
    },

    getFactoryComment: async (key) => find(key)?.factoryComment,

    putFactoryComment: async (key, body) => {
      replace(key, { factoryComment: body });
    },

    addAttachment: async ({ key, name, content }) => {
      state.attachments = [...state.attachments, content];
      const link = `${LINK_PREFIX}${state.attachments.length - 1}/${name}`;
      state.listed = [...state.listed, { key, name, link }];
      return link;
    },

    listAttachments: async (key) => state.listed.filter((attachment) => attachment.key === key).map(({ name, link }) => ({ name, link })),

    readAttachment: async (link) => {
      const content = state.attachments[Number(link.slice(LINK_PREFIX.length).split('/')[0])];
      if (content === undefined) throw new Error(`No attachment at ${link}`);
      return content;
    },

    search: async (criteria) => state.tickets.filter((ticket) => matches(ticket, criteria)),

    listStatuses: async () => statuses ?? [...new Set(state.tickets.map((ticket) => ticket.status))].map((name) => ({ name, category: 'unknown' as const })),

    checkAccess: async (key) => {
      if (find(key) === undefined) throw new Error(`Ticket ${key} was not found`);
      return access;
    },

    canReenter: async ({ key }) => {
      if (find(key) === undefined) throw new Error(`Ticket ${key} was not found`);
      return false;
    },
  };
};
