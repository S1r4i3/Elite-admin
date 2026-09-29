import type { Collection } from "./types";
import { SERVICES, taxYears } from "./types";

/** A form field in the add/edit modal. */
export type Field = {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "number" | "date" | "select" | "textarea" | "password";
  options?: string[];
  required?: boolean;
  half?: boolean;
  hint?: string;
  /** Only shown to a Super Admin. */
  superOnly?: boolean;
  /** Options loaded at runtime (e.g. the employee list) instead of `options`. */
  optionsFrom?: "employees";
};

/** A column in the table. `cell` names a renderer defined in components/data-table.tsx. */
export type Column = {
  key: string;
  label: string;
  cell?: "strong" | "badge" | "date" | "datetime" | "money" | "mono" | "size" | "client" | "tel" | "fullname" | "docstatus" | "prep" | "employee" | "role" | "count";
  sortable?: boolean;
  /** Only shown to a Super Admin. */
  superOnly?: boolean;
};

export type Section = {
  slug: string;
  label: string;
  icon: string;
  group: string;
  collection: Collection;
  title: string;
  subtitle: string;
  /** Fixed query sent to the API, e.g. { kind: "draft" } */
  query?: Record<string, string>;
  columns: Column[];
  fields: Field[];
  search: string[];
  filters?: { key: string; label: string; options: string[] }[];
  addLabel?: string;
  /** Shows the "Share document with client" button instead of a plain Add button. */
  uploadKind?: "upload" | "draft" | "final";
  countKey?: "clients" | "uploads" | "draftsAwaiting" | "finals" | "newLeads" | "inquiries";
  /** Hidden from employees — only a Super Admin can open this section. */
  superOnly?: boolean;
};

const YEARS = taxYears();

export const SECTIONS: Section[] = [
  {
    slug: "clients",
    label: "All Clients",
    icon: "👥",
    group: "Clients",
    collection: "clients",
    title: "All Clients",
    subtitle: "Every registered client account",
    countKey: "clients",
    addLabel: "Add client",
    search: ["firstName", "lastName", "email", "phone", "clientId", "holderCode", "prepStatus"],
    filters: [
      { key: "docStatus", label: "All doc statuses", options: ["pending", "received"] },
      { key: "stage", label: "All stages", options: ["unassigned", "documents", "preparation", "review", "client_review", "filing", "accepted", "closed"] },
    ],
    columns: [
      { key: "clientId", label: "Client ID", cell: "mono" },
      { key: "firstName", label: "Name", cell: "fullname" },
      { key: "phone", label: "Phone", cell: "tel" },
      { key: "email", label: "Email" },
      { key: "docStatus", label: "Doc status", cell: "docstatus" },
      { key: "prepStatus", label: "Preparation status", cell: "prep" },
      { key: "holderCode", label: "Currently with", cell: "mono", superOnly: true },
    ],
    fields: [
      { name: "firstName", label: "First name", required: true, half: true },
      { name: "lastName", label: "Last name", required: true, half: true },
      { name: "email", label: "Email", type: "email", required: true, half: true },
      { name: "phone", label: "Phone", type: "tel", required: true, half: true },
      { name: "dob", label: "Date of birth", type: "date", half: true },
      { name: "service", label: "Service", type: "select", options: SERVICES, half: true },
      { name: "state", label: "State", half: true },
      { name: "country", label: "Country", half: true },
      { name: "taxYear", label: "Tax year", type: "select", options: YEARS, half: true },
      { name: "status", label: "Status", type: "select", options: ["active", "pending", "inactive"], half: true },
      { name: "docStatus", label: "Doc status", type: "select", options: ["pending", "received"], half: true },
      { name: "address", label: "Address" },
      {
        name: "assignedTo",
        label: "Currently with (assign)",
        type: "select",
        optionsFrom: "employees",
        superOnly: true,
        hint: "Admin only. New clients are assigned to a Document Handler automatically — use this to reassign (e.g. someone is away).",
      },
    ],
  },
  {
    slug: "documents",
    label: "Client Documents",
    icon: "📄",
    group: "Clients",
    collection: "documents",
    title: "Client Documents",
    subtitle: "Files uploaded by clients",
    query: { kind: "upload" },
    countKey: "uploads",
    uploadKind: "upload",
    search: ["name", "type", "note"],
    filters: [{ key: "taxYear", label: "All tax years", options: YEARS }],
    columns: [
      { key: "name", label: "File", cell: "strong" },
      { key: "clientId", label: "Client", cell: "client" },
      { key: "type", label: "Type" },
      { key: "taxYear", label: "Tax year" },
      { key: "sizeKb", label: "Size", cell: "size" },
      { key: "createdAt", label: "Received", cell: "datetime" },
    ],
    fields: [
      { name: "name", label: "File name", required: true },
      { name: "type", label: "Document type", half: true },
      { name: "taxYear", label: "Tax year", type: "select", options: YEARS, half: true },
      { name: "note", label: "Note", type: "textarea" },
    ],
  },
  {
    slug: "drafts",
    label: "Draft Estimations",
    icon: "🧮",
    group: "Clients",
    collection: "documents",
    title: "Draft Estimations",
    subtitle: "Drafts shared with clients for review",
    query: { kind: "draft" },
    countKey: "draftsAwaiting",
    uploadKind: "draft",
    search: ["name", "note"],
    filters: [
      { key: "status", label: "All statuses", options: ["awaiting_review", "approved", "changes_requested"] },
      { key: "taxYear", label: "All tax years", options: YEARS },
    ],
    columns: [
      { key: "name", label: "File", cell: "strong" },
      { key: "clientId", label: "Client", cell: "client" },
      { key: "taxYear", label: "Tax year" },
      { key: "note", label: "Note to client" },
      { key: "status", label: "Status", cell: "badge" },
      { key: "createdAt", label: "Shared", cell: "datetime" },
    ],
    fields: [
      { name: "name", label: "File name", required: true },
      { name: "taxYear", label: "Tax year", type: "select", options: YEARS, half: true },
      { name: "status", label: "Status", type: "select", options: ["awaiting_review", "approved", "changes_requested"], half: true },
      { name: "note", label: "Note to client", type: "textarea" },
    ],
  },
  {
    slug: "finals",
    label: "Final Documents",
    icon: "✅",
    group: "Clients",
    collection: "documents",
    title: "Final Documents",
    subtitle: "Completed returns shared with clients",
    query: { kind: "final" },
    countKey: "finals",
    uploadKind: "final",
    search: ["name", "note"],
    filters: [{ key: "taxYear", label: "All tax years", options: YEARS }],
    columns: [
      { key: "name", label: "File", cell: "strong" },
      { key: "clientId", label: "Client", cell: "client" },
      { key: "taxYear", label: "Tax year" },
      { key: "note", label: "Note" },
      { key: "sizeKb", label: "Size", cell: "size" },
      { key: "createdAt", label: "Shared", cell: "datetime" },
    ],
    fields: [
      { name: "name", label: "File name", required: true },
      { name: "taxYear", label: "Tax year", type: "select", options: YEARS, half: true },
      { name: "note", label: "Note", type: "textarea" },
    ],
  },
  {
    slug: "leads",
    label: "Leads",
    icon: "📥",
    group: "Enquiries",
    collection: "leads",
    superOnly: true,
    title: "Leads",
    subtitle: "Requests from the website forms",
    countKey: "newLeads",
    addLabel: "Add lead",
    search: ["name", "email", "phone", "service", "message"],
    filters: [{ key: "status", label: "All statuses", options: ["new", "contacted", "qualified", "converted", "closed"] }],
    columns: [
      { key: "name", label: "Name", cell: "strong" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone", cell: "tel" },
      { key: "service", label: "Service" },
      { key: "status", label: "Status", cell: "badge" },
      { key: "createdAt", label: "Received", cell: "date" },
    ],
    fields: [
      { name: "name", label: "Name", required: true, half: true },
      { name: "email", label: "Email", type: "email", half: true },
      { name: "phone", label: "Phone", type: "tel", half: true },
      { name: "service", label: "Service", type: "select", options: SERVICES, half: true },
      { name: "taxYear", label: "Tax year", type: "select", options: YEARS, half: true },
      { name: "status", label: "Status", type: "select", options: ["new", "contacted", "qualified", "converted", "closed"], half: true },
      { name: "message", label: "Message", type: "textarea" },
    ],
  },
  {
    slug: "inquiries",
    label: "Website Inquiries",
    icon: "💬",
    group: "Enquiries",
    collection: "inquiries",
    superOnly: true,
    title: "Website Inquiries",
    subtitle: "Messages from the website pop-up form",
    countKey: "inquiries",
    addLabel: "Add inquiry",
    search: ["name", "phone", "message"],
    columns: [
      { key: "name", label: "Name", cell: "strong" },
      { key: "phone", label: "Mobile", cell: "tel" },
      { key: "message", label: "Message" },
      { key: "page", label: "Page" },
      { key: "createdAt", label: "Received", cell: "datetime" },
    ],
    fields: [
      { name: "name", label: "Name", required: true, half: true },
      { name: "phone", label: "Mobile number", required: true, half: true },
      { name: "page", label: "Page", half: true },
      { name: "message", label: "Message", type: "textarea" },
    ],
  },
  {
    slug: "cms-pages",
    label: "Manage CMS Pages",
    icon: "📝",
    group: "Website content",
    collection: "cmsPages",
    superOnly: true,
    title: "Manage CMS Pages",
    subtitle: "Editable page content",
    addLabel: "Add page",
    search: ["title", "slug", "body"],
    columns: [
      { key: "title", label: "Page name", cell: "strong" },
      { key: "slug", label: "URL", cell: "mono" },
      { key: "body", label: "Content" },
      { key: "updatedAt", label: "Updated", cell: "date" },
    ],
    fields: [
      { name: "title", label: "Page name", required: true, half: true },
      { name: "slug", label: "URL path", required: true, half: true },
      { name: "body", label: "Content", type: "textarea" },
    ],
  },
  {
    slug: "banners",
    label: "Home Banners",
    icon: "🖼",
    group: "Website content",
    collection: "banners",
    superOnly: true,
    title: "Home Banners",
    subtitle: "Slides at the top of the homepage",
    addLabel: "Add banner",
    search: ["title", "subtitle"],
    columns: [
      { key: "title", label: "Title", cell: "strong" },
      { key: "subtitle", label: "Subtitle" },
      { key: "cta", label: "Button" },
      { key: "link", label: "Link", cell: "mono" },
      { key: "active", label: "Shown", cell: "badge" },
    ],
    fields: [
      { name: "title", label: "Title", required: true },
      { name: "subtitle", label: "Subtitle" },
      { name: "cta", label: "Button label", half: true },
      { name: "link", label: "Button link", half: true },
      { name: "active", label: "Shown on site", type: "select", options: ["true", "false"], half: true },
    ],
  },
  {
    slug: "services",
    label: "Services & Pricing",
    icon: "🏷",
    group: "Website content",
    collection: "services",
    superOnly: true,
    title: "Services & Pricing",
    subtitle: "Services listed on the website",
    addLabel: "Add service",
    search: ["name"],
    columns: [
      { key: "name", label: "Service", cell: "strong" },
      { key: "price", label: "Price", cell: "money" },
      { key: "active", label: "Shown", cell: "badge" },
      { key: "updatedAt", label: "Updated", cell: "date" },
    ],
    fields: [
      { name: "name", label: "Service name", required: true },
      { name: "price", label: "Price (USD)", type: "number", half: true },
      { name: "active", label: "Shown on site", type: "select", options: ["true", "false"], half: true },
    ],
  },
  {
    slug: "tax-notes",
    label: "Tax Notes",
    icon: "📌",
    group: "Website content",
    collection: "taxNotes",
    superOnly: true,
    title: "Manage Tax Notes",
    subtitle: "Internal notes and reminders for the team",
    addLabel: "Add note",
    search: ["title", "body"],
    columns: [
      { key: "title", label: "Title", cell: "strong" },
      { key: "body", label: "Note" },
      { key: "updatedAt", label: "Updated", cell: "date" },
    ],
    fields: [
      { name: "title", label: "Title", required: true },
      { name: "body", label: "Note", type: "textarea" },
    ],
  },
  {
    slug: "employees",
    label: "Employees",
    icon: "🧑‍💼",
    group: "Administration",
    collection: "employees",
    superOnly: true,
    title: "Employees",
    subtitle: "Staff, how many clients each one holds now and has handled in total. Click a name for their clients and move history.",
    addLabel: "Add employee",
    search: ["name", "email", "role"],
    filters: [{ key: "role", label: "All roles", options: ["Admin", "Document Handler", "Tax Preparer", "Reviewer", "Tax Filer"] }],
    columns: [
      { key: "name", label: "Name", cell: "employee" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone", cell: "tel" },
      { key: "role", label: "Role", cell: "role" },
      { key: "currentClients", label: "Current clients", cell: "count" },
      { key: "totalClients", label: "Total clients", cell: "count" },
      { key: "status", label: "Status", cell: "badge" },
      { key: "createdAt", label: "Added", cell: "date" },
    ],
    fields: [
      { name: "name", label: "Full name", required: true, half: true },
      { name: "email", label: "Email", type: "email", required: true, half: true },
      { name: "phone", label: "Phone", type: "tel", half: true },
      { name: "password", label: "Password", type: "password", required: true, half: true, hint: "At least 8 characters. When editing, leave blank to keep the current password." },
      { name: "role", label: "Role", type: "select", options: ["Document Handler", "Tax Preparer", "Reviewer", "Tax Filer", "Admin"], half: true },
      { name: "code", label: "Queue code", half: true, hint: "Like DH1, TP1, RV1. Leave blank to generate it automatically." },
      { name: "status", label: "Status", type: "select", options: ["active", "inactive"], half: true },
    ],
  },
  {
    slug: "logs",
    label: "Admin Logs",
    icon: "🔔",
    group: "Administration",
    collection: "logs",
    superOnly: true,
    title: "Admin Logs",
    subtitle: "Everything done inside this panel",
    search: ["who", "action", "detail"],
    columns: [
      { key: "action", label: "Action", cell: "strong" },
      { key: "detail", label: "Detail" },
      { key: "who", label: "By" },
      { key: "createdAt", label: "When", cell: "datetime" },
    ],
    fields: [],
  },
];

export const sectionBySlug = (slug: string) => SECTIONS.find((s) => s.slug === slug) || null;

export const NAV_GROUPS = ["Clients", "Enquiries", "Website content", "Administration"];
