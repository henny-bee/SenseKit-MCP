// Hand-written shapes for the QRS (Repository Service) entities this server
// reads. QRS entities are large and version-dependent; each interface types
// the fields a tool actually maps and keeps an index signature for the rest
// (they are passed through redaction untouched).

export interface QrsUserRef { userDirectory?: string; userId?: string; [key: string]: unknown }

export interface QrsEntity { id: string; name?: string; [key: string]: unknown }

export interface QrsOwned extends QrsEntity { owner?: QrsUserRef }

export interface QrsApp extends QrsOwned {
  stream?: { name?: string; [key: string]: unknown } | null;
  published?: boolean;
  lastReloadTime?: string;
  fileSize?: number;
}

export interface QrsExecutionResult {
  status: number;
  startTime?: string;
  stopTime?: string;
  duration?: number;
  executingNodeName?: string;
  fileReferenceID?: string;
  details?: Array<{ detailCreatedDate?: string; detailsType?: number; message?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface QrsReloadTask extends QrsEntity {
  enabled?: boolean;
  app?: { id?: string; name?: string; [key: string]: unknown };
  operational?: { lastExecutionResult?: QrsExecutionResult; [key: string]: unknown };
}

export interface QrsUser extends QrsEntity {
  userDirectory?: string;
  userId?: string;
  roles?: string[];
  inactive?: boolean;
  removedExternally?: boolean;
}

export interface QrsDataConnection extends QrsOwned { type?: string; connectionstring?: string }

export interface QrsServiceStatus extends Omit<QrsEntity, "id"> {
  serviceType: number;
  serviceState: number;
  serverNodeConfiguration?: { hostName?: string; name?: string; [key: string]: unknown };
}

export interface QrsLicense {
  serial?: string;
  name?: string;
  organization?: string;
  isExpired?: boolean;
  isSubscription?: boolean;
  keyDetails?: string;
  [key: string]: unknown;
}

export interface QrsAccessType { user?: QrsUserRef; [key: string]: unknown }

export interface QrsSystemRule extends QrsEntity {
  type?: string;
  disabled?: boolean;
  resourceFilter?: string;
  actions?: number;
  rule?: string;
  comment?: string;
}
