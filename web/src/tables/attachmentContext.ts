import { createContext } from 'react';
import type { AttachmentContext } from '@shared/attachmentUrls';

export const TableAttachmentContext = createContext<AttachmentContext | undefined>(undefined);
