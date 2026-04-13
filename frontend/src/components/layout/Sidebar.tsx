import { useState, useMemo } from 'react';
import { NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { getConversations, createConversation, updateConversation, deleteConversation } from '@/api/chat';
import { fetchApi } from '@/api/client';
import {
  getKnowledgeBases,
  createKnowledgeBase,
  deleteKnowledgeBase,
} from '@/api/knowledge-bases';
import {
  getScenarios,
  createScenario,
  deleteScenario,
  duplicateScenario,
} from '@/api/scenarios';
import { toast } from '@/components/ui/toast';
import { SidebarList, type SidebarListItem } from './SidebarList';

type Section = 'chat' | 'knowledge-bases' | 'scenarios';

const NAV_ICONS = {
  chat: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  'knowledge-bases': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  ),
  scenarios: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6"/><path d="m17.66 6.34-4.24 4.24m-2.84 2.84-4.24 4.24"/><path d="M23 12h-6m-6 0H5"/><path d="m17.66 17.66-4.24-4.24m-2.84-2.84L6.34 6.34"/>
    </svg>
  ),
};

const NAV_ITEMS: { to: string; section: Section; label: string }[] = [
  { to: '/chat', section: 'chat', label: 'Чат' },
  { to: '/knowledge-bases', section: 'knowledge-bases', label: 'Базы знаний' },
  { to: '/scenarios', section: 'scenarios', label: 'Сценарии' },
];

function detectSection(pathname: string): Section {
  if (pathname.startsWith('/knowledge-bases')) return 'knowledge-bases';
  if (pathname.startsWith('/scenarios')) return 'scenarios';
  return 'chat';
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams();
  const [search, setSearch] = useState('');
  const [selectedKbId, setSelectedKbId] = useState<string>('');

  const section = detectSection(location.pathname);

  // Queries — all 3 kept alive but only one shown based on section.
  // React Query caches them; cheap to do in parallel.
  const conversationsQ = useQuery({
    queryKey: ['conversations', section === 'chat' ? search : ''],
    queryFn: () => getConversations(section === 'chat' && search ? search : undefined),
    enabled: section === 'chat',
  });
  const kbsQ = useQuery({
    queryKey: ['knowledge-bases', section === 'knowledge-bases' ? search : ''],
    queryFn: () =>
      getKnowledgeBases(section === 'knowledge-bases' && search ? search : undefined),
  });
  const scenariosQ = useQuery({
    queryKey: ['scenarios'],
    queryFn: getScenarios,
    enabled: section === 'scenarios',
  });

  // Mutations per section
  const createConvMut = useMutation({
    mutationFn: () => createConversation(undefined, selectedKbId || undefined),
    onSuccess: (conv) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setSelectedKbId('');
      navigate(`/chat/${conv.id}`);
    },
  });
  const deleteConvMut = useMutation({
    mutationFn: deleteConversation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (params.conversationId) navigate('/chat');
    },
  });

  const [newKbName, setNewKbName] = useState('');
  const [showKbCreate, setShowKbCreate] = useState(false);
  const createKbMut = useMutation({
    mutationFn: (name: string) => createKnowledgeBase(name),
    onSuccess: (kb) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      setNewKbName('');
      setShowKbCreate(false);
      navigate(`/knowledge-bases/${kb.id}`);
    },
  });
  const deleteKbMut = useMutation({
    mutationFn: deleteKnowledgeBase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      toast('База знаний удалена', 'success');
      if (params.kbId) navigate('/knowledge-bases');
    },
    onError: () => toast('Не удалось удалить', 'error'),
  });

  const [newScenarioName, setNewScenarioName] = useState('');
  const [showScenarioCreate, setShowScenarioCreate] = useState(false);
  const createScenarioMut = useMutation({
    mutationFn: (name: string) => createScenario(name),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      setNewScenarioName('');
      setShowScenarioCreate(false);
      navigate(`/scenarios/${s.id}/edit`);
    },
  });
  const deleteScenarioMut = useMutation({
    mutationFn: deleteScenario,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      toast('Сценарий удалён', 'success');
      if (params.scenarioId) navigate('/scenarios');
    },
    onError: () => toast('Не удалось удалить', 'error'),
  });

  // Normalized items for the list
  const listItems = useMemo<SidebarListItem[]>(() => {
    if (section === 'chat') {
      return (conversationsQ.data || []).map((c) => ({
        id: c.id,
        title: c.title,
        created_at: c.created_at,
      }));
    }
    if (section === 'knowledge-bases') {
      return (kbsQ.data || []).map((kb) => ({
        id: kb.id,
        title: kb.name,
        created_at: kb.created_at,
      }));
    }
    if (section === 'scenarios') {
      const sc = scenariosQ.data || [];
      const filtered = search
        ? sc.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
        : sc;
      return filtered.map((s) => ({
        id: s.id,
        title: s.name,
        created_at: s.created_at,
      }));
    }
    return [];
  }, [section, conversationsQ.data, kbsQ.data, scenariosQ.data, search]);

  const activeId =
    section === 'chat'
      ? params.conversationId
      : section === 'knowledge-bases'
        ? params.kbId
        : params.scenarioId;

  const handleItemClick = (id: string) => {
    if (section === 'chat') navigate(`/chat/${id}`);
    else if (section === 'knowledge-bases') navigate(`/knowledge-bases/${id}`);
    else if (section === 'scenarios') navigate(`/scenarios/${id}/edit`);
  };

  const handleItemDelete = (id: string) => {
    if (section === 'chat') {
      if (confirm('Удалить диалог?')) deleteConvMut.mutate(id);
    } else if (section === 'knowledge-bases') {
      if (confirm('Удалить базу знаний? Все документы будут удалены.')) {
        deleteKbMut.mutate(id);
      }
    } else if (section === 'scenarios') {
      if (confirm('Удалить сценарий?')) deleteScenarioMut.mutate(id);
    }
  };

  const handleItemRename = async (id: string, newTitle: string) => {
    if (section === 'chat') {
      await updateConversation(id, newTitle);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } else if (section === 'knowledge-bases') {
      await fetchApi(`/knowledge-bases/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: newTitle }),
      });
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
    } else if (section === 'scenarios') {
      await fetchApi(`/scenarios/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: newTitle }),
      });
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
    }
  };

  const handleDuplicateScenario = async (id: string) => {
    await duplicateScenario(id);
    queryClient.invalidateQueries({ queryKey: ['scenarios'] });
    toast('Сценарий скопирован', 'success');
  };

  // Contextual placeholder for search
  const searchPlaceholder =
    section === 'chat'
      ? 'Поиск диалогов...'
      : section === 'knowledge-bases'
        ? 'Поиск баз знаний...'
        : 'Поиск сценариев...';

  const emptyText =
    section === 'chat'
      ? 'Нет диалогов'
      : section === 'knowledge-bases'
        ? 'Нет баз знаний'
        : 'Нет сценариев';

  // Knowledge bases dropdown for new chat
  const availableKbs = kbsQ.data || [];

  return (
    <aside className="w-72 border-r border-border bg-card flex flex-col shadow-sm">
      {/* Logo */}
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-[#21a038] flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
        </div>
        <span className="text-lg font-bold tracking-tight text-foreground">GigaMe</span>
      </div>

      {/* Navigation */}
      <nav className="px-3 pt-1 pb-2 space-y-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={false}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all ${
                isActive
                  ? 'bg-[#21a038] text-white font-medium shadow-sm'
                  : 'text-foreground/70 hover:bg-accent hover:text-foreground'
              }`
            }
          >
            {NAV_ICONS[item.section]}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border" />

      {/* Contextual action area */}
      <div className="px-3 py-3 space-y-2">
        {/* Search */}
        <div className="relative">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full text-xs bg-background border border-border rounded-lg pl-8 pr-2.5 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#21a038]"
          />
        </div>

        {/* Section-specific create UI */}
        {section === 'chat' && (
          <>
            {availableKbs.length > 0 && (
              <select
                value={selectedKbId}
                onChange={(e) => setSelectedKbId(e.target.value)}
                className="w-full text-xs bg-background border border-border rounded-lg px-2.5 py-1.5 text-foreground"
              >
                <option value="">Без базы знаний</option>
                {availableKbs.map((kb) => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => createConvMut.mutate()}
              disabled={createConvMut.isPending}
              className="w-full text-sm bg-[#21a038] text-white font-medium rounded-xl px-3 py-2 hover:bg-[#1b8a30] transition-colors disabled:opacity-50"
            >
              + Новый диалог
            </button>
          </>
        )}

        {section === 'knowledge-bases' && (
          <>
            {showKbCreate ? (
              <div className="space-y-1.5">
                <input
                  value={newKbName}
                  onChange={(e) => setNewKbName(e.target.value)}
                  placeholder="Название базы знаний"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newKbName.trim()) {
                      createKbMut.mutate(newKbName.trim());
                    } else if (e.key === 'Escape') {
                      setShowKbCreate(false);
                      setNewKbName('');
                    }
                  }}
                  className="w-full text-xs bg-background border border-border rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-[#21a038]"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={() => newKbName.trim() && createKbMut.mutate(newKbName.trim())}
                    disabled={!newKbName.trim() || createKbMut.isPending}
                    className="flex-1 text-xs bg-[#21a038] text-white font-medium rounded-lg px-2 py-1.5 hover:bg-[#1b8a30] disabled:opacity-50"
                  >
                    Создать
                  </button>
                  <button
                    onClick={() => {
                      setShowKbCreate(false);
                      setNewKbName('');
                    }}
                    className="flex-1 text-xs border border-border rounded-lg px-2 py-1.5 hover:bg-accent"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowKbCreate(true)}
                className="w-full text-sm bg-[#21a038] text-white font-medium rounded-xl px-3 py-2 hover:bg-[#1b8a30] transition-colors"
              >
                + Новая база знаний
              </button>
            )}
          </>
        )}

        {section === 'scenarios' && (
          <>
            {showScenarioCreate ? (
              <div className="space-y-1.5">
                <input
                  value={newScenarioName}
                  onChange={(e) => setNewScenarioName(e.target.value)}
                  placeholder="Название сценария"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newScenarioName.trim()) {
                      createScenarioMut.mutate(newScenarioName.trim());
                    } else if (e.key === 'Escape') {
                      setShowScenarioCreate(false);
                      setNewScenarioName('');
                    }
                  }}
                  className="w-full text-xs bg-background border border-border rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-[#21a038]"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={() =>
                      newScenarioName.trim() && createScenarioMut.mutate(newScenarioName.trim())
                    }
                    disabled={!newScenarioName.trim() || createScenarioMut.isPending}
                    className="flex-1 text-xs bg-[#21a038] text-white font-medium rounded-lg px-2 py-1.5 hover:bg-[#1b8a30] disabled:opacity-50"
                  >
                    Создать
                  </button>
                  <button
                    onClick={() => {
                      setShowScenarioCreate(false);
                      setNewScenarioName('');
                    }}
                    className="flex-1 text-xs border border-border rounded-lg px-2 py-1.5 hover:bg-accent"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowScenarioCreate(true)}
                className="w-full text-sm bg-[#21a038] text-white font-medium rounded-xl px-3 py-2 hover:bg-[#1b8a30] transition-colors"
              >
                + Новый сценарий
              </button>
            )}
          </>
        )}
      </div>

      <div className="border-t border-border" />

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto py-1">
        <SidebarList
          items={listItems}
          activeId={activeId}
          onClick={handleItemClick}
          onDelete={handleItemDelete}
          onRename={handleItemRename}
          emptyText={emptyText}
          renderExtraActions={
            section === 'scenarios'
              ? (item) => (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDuplicateScenario(item.id);
                    }}
                    className="p-1 rounded hover:bg-background hover:text-foreground"
                    title="Дублировать"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                )
              : undefined
          }
        />
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border">
        <div className="text-[10px] text-muted-foreground leading-tight">
          Разработано Центром снабжения
        </div>
      </div>
    </aside>
  );
}
