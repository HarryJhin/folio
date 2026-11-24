import { createContext, useContext } from 'react';

export const AssistantEnabledContext = createContext(true);

export function useAssistantEnabled(): boolean {
  return useContext(AssistantEnabledContext);
}
