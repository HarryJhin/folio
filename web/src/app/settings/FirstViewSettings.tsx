import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SpaceFirstView, SpaceInfo, SpaceList } from '@shared/contracts';
import { api } from '../api';
import { useApiErrorText } from '../errorText';

export function FirstViewSettings({ space }: { space: SpaceInfo }) {
  const { t } = useTranslation('app');
  const errorText = useApiErrorText();
  const queryClient = useQueryClient();
  const id = useId();
  const savedView = space.firstView ?? 'graph';
  const [draft, setDraft] = useState<SpaceFirstView | null>(null);
  const selected = draft ?? savedView;

  const save = useMutation({
    mutationFn: (view: SpaceFirstView) => api.setSpaceFirstView(space.slug, view),
    onSuccess: ({ firstView }) => {
      queryClient.setQueryData<SpaceList>(['spaces'], (data) => data && ({
        ...data,
        spaces: data.spaces.map((entry) => entry.slug === space.slug ? { ...entry, firstView } : entry),
      }));
      setDraft(null);
      return queryClient.invalidateQueries({ queryKey: ['spaces'] });
    },
  });

  return (
    <form
      aria-labelledby={id}
      className="mb-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700"
      onSubmit={(event) => {
        event.preventDefault();
        if (selected !== savedView && !save.isPending) save.mutate(selected);
      }}
    >
      <fieldset disabled={save.isPending}>
        <legend id={id} className="mb-2 text-sm font-semibold">{t('spaceSettings.firstView.title')}</legend>
        <div className="flex flex-wrap gap-4">
          {(['graph', 'home'] as const).map((view) => (
            <label htmlFor={id + view} key={view} className="flex items-center gap-2 text-sm">
              <input
                id={id + view}
                type="radio"
                name="firstView"
                value={view}
                checked={selected === view}
                onChange={() => {
                  setDraft(view);
                  save.reset();
                }}
              />
              {view === 'graph' ? t('graph.title') : t('sidebar.spaceHome')}
            </label>
          ))}
        </div>
        <button
          type="submit"
          disabled={selected === savedView || save.isPending}
          className="mt-3 rounded border border-neutral-300 px-3 py-1 text-sm disabled:opacity-50 dark:border-neutral-600"
        >
          {t('spaceSettings.firstView.save')}
        </button>
        {save.isError && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{errorText(save.error, 'spaceSettings.saveFailed')}</p>}
        {save.isSuccess && <p role="status" className="mt-2 text-sm">{t('spaceSettings.firstView.saved')}</p>}
      </fieldset>
    </form>
  );
}
