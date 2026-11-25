// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import i18next from 'i18next';
import { AssistantEnabledContext } from '../assistant/availability';
import { FolderView } from '../routes/FolderView';
import { ToastProvider } from '../ui/Toast';
import { Sidebar } from './Sidebar';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Editor' }, memberships: { sp: 'editor' } }),
  useSpaceRole: () => 'editor',
}));

beforeAll(() => i18next.changeLanguage('en'));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('creates a page inside the folder opened by its URL, preserving literal filename characters', async () => {
  const dir = '문서 모음/Photos %20 #1?';
  const title = 'Photos %20 #1?';
  const tree = [{ id: 'dir:' + dir, space: 'sp', kind: 'folder', path: dir, title, children: [] }];
  const created = vi.fn();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/pages' && init?.method === 'POST') {
      created(JSON.parse(String(init.body)));
      return Response.json({ id: 'new', space: 'sp', path: dir + '/new-page.md', title: 'New page', kind: 'doc' });
    }
    if (url === '/api/spaces/sp/tree') return Response.json({ tree });
    return new Response(null, { status: 404 });
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AssistantEnabledContext.Provider value={false}>
          <MemoryRouter initialEntries={['/s/sp/d/' + dir.split('/').map(encodeURIComponent).join('/')]}>
            <Sidebar space="sp" desktopCollapsed={false} mobileOpen={false} onMobileClose={() => {}} />
            <Routes>
              <Route path="/s/:space/d/*" element={<FolderView />} />
              <Route path="/s/:space/p/:id" element={<div>Created document</div>} />
            </Routes>
          </MemoryRouter>
        </AssistantEnabledContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  );

  await screen.findByRole('heading', { name: title });
  fireEvent.click(screen.getByRole('button', { name: 'New page at the space root' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'New page' }));
  await waitFor(() => expect(created).toHaveBeenCalledWith(expect.objectContaining({ parentPath: dir })));
});
