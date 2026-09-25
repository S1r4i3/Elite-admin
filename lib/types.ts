/** Shared types for the admin panel and its REST API. */

export type Collection =
  | "clients"
  | "documents"
  | "leads"
  | "inquiries"
  | "cmsPages"
  | "banners"
  | "services"
  | "taxNotes"
  | "employees"
  | "logs";

export type Row = { id: string; createdAt: string; updatedAt?: string; [key: string]: unknown };

export type Client = Row & {
  clientId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob?: string;
  address?: string;
  state?: string;
  country?: string;
  service: string;
  taxYear: string;
  status: "active" | "pending" | "inactive";
  lastLoginAt?: string | null;
  /** Email of the employee who currently holds this client (null/"" = unassigned). */
  assignedTo?: string | null;
  docStatus?: "pending" | "partial" | "received";
  stage?: "unassigned" | "documents" | "preparation" | "review" | "filed";
  pendingTo?: string | null;
  pendingStage?: string | null;
  pendingBy?: string | null;
  pendingNote?: string | null;
  pendingAt?: string | null;
  rejectReason?: string | null;
  /** Filled in by the API for display: holder code (DH1…) and the "Preparation status" text. */
  holderCode?: string;
  prepStatus?: string;
};

export type DocKind = "upload" | "draft" | "final";
export type DraftStatus = "awaiting_review" | "approved" | "changes_requested" | "";

export type DocumentRow = Row & {
  clientId: string;
  kind: DocKind;
  name: string;
  type: string;
  taxYear: string;
  sizeKb: number;
  storageKey: string;
  note: string;
  status: DraftStatus;
  clientComment?: string;
  uploadedBy: "client" | "staff";
};

export type Lead = Row & {
  name: string;
  email: string;
  phone: string;
  service: string;
  taxYear: string;
  message: string;
  status: "new" | "contacted" | "qualified" | "converted" | "closed";
};

export type Inquiry = Row & { name: string; phone: string; message: string; page: string };
export type CmsPage = Row & { title: string; slug: string; body: string };
export type Banner = Row & { title: string; subtitle: string; cta: string; link: string; active: string };
export type Service = Row & { name: string; price: number; active: string };
export type TaxNote = Row & { title: string; body: string };
export type Employee = Row & {
  name: string;
  email: string;
  phone: string;
  role: "Admin" | "Document Handler" | "Tax Preparer" | "Reviewer" | "Super Admin" | "Preparer" | "Associate";
  /** Short queue code, e.g. DH1, TP2, RV1. */
  code?: string;
  status: "active" | "inactive";
  passwordHash?: string;
};
export type LogRow = Row & { who: string; action: string; detail: string };

export type Settings = {
  companyName: string;
  taxYear: string;
  phoneUs: string;
  phoneIn: string;
  whatsapp: string;
  email: string;
  address: string;
  facebook: string;
  instagram: string;
  linkedin: string;
  youtube: string;
  seoTitle: string;
  seoDescription: string;
};

export type DB = {
  settings: Settings;
  clients: Client[];
  documents: DocumentRow[];
  leads: Lead[];
  inquiries: Inquiry[];
  cmsPages: CmsPage[];
  banners: Banner[];
  services: Service[];
  taxNotes: TaxNote[];
  employees: Employee[];
  logs: LogRow[];
};

export const SERVICES = [
  "Federal Tax Filing",
  "State Tax Filing",
  "FBAR / FATCA",
  "ITIN Services",
  "Tax Amendments",
  "IRS Representation",
  "LLC Services",
  "Entity Formation",
  "Corporate Tax",
  "Bookkeeping",
  "Payroll",
  "Indian / NRI Tax",
];

export const taxYears = () => {
  const y = new Date().getFullYear();
  return [y, y - 1, y - 2, y - 3, y - 4].map(String);
};
