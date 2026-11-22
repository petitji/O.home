'use client';
// 상단 바 — 기획서 3장(계층 메뉴) + 4.0(프로필 드롭다운 · 편집모드 · 그리드 토글)
// 로고 클릭 = 메인 이동 (v1.5) · 상위 메뉴 클릭 = 첫 하위 페이지 이동 (v1.8)
// 편집모드 중 페이지 이동 시도 → 종료 확인 모달 (v1.8)
import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { boardEntries, useMenuSettings, buildMenu, defaultTree, menuLabelFor } from '@/lib/menuStore';
import type { MenuItem } from '@/lib/menu';
import { useBoards } from '@/lib/boardStore';
import { useSections, sectionMenuEntries } from '@/lib/sectionStore';
import { useCustomLinks, linkEntries } from '@/lib/linkStore';
import { useSiteSettings } from '@/lib/siteStore';
import { useAuth } from '@/lib/auth';
import { useMainStore, EDIT_END_EVENT } from '@/lib/mainStore';
import { useBlobUrl } from '@/lib/blobStore';
import { refreshPage } from '@/lib/pageRefresh';
import { useToast } from '@/components/ui/Toast';
import { KToggle } from '@/components/ui/Kit';
import {
  Notif, NotifType, NOTIF_EVENT, NOTIF_TYPE_LABEL,
  readNotifs, markRead, markAllRead, clearReadNotifs, notifSettings, setNotifSetting, syncNotifs,
} from '@/lib/notifStore';
import { subscribeTable } from '@/lib/db';

const BellIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M6 9.5a6 6 0 0 1 12 0c0 4.2 1.6 5.6 2.2 6.3H3.8C4.4 15.1 6 13.7 6 9.5Z" />
    <path d="M10 18.8a2.1 2.1 0 0 0 4 0" />
  </svg>
);

/* 편집모드 메뉴 이름 초안 키 — 상위(또는 단독)는 g:<id>, 하위는 i:<상위 id>|<주소> */
const gKey = (gid: string) => `g:${gid}`;
const iKey = (gid: string, href: string) => `i:${gid}|${href}`;

/** 편집모드에서 상단바 메뉴 이름을 바로 고치는 입력칸 (v2.0 사용자 요청) */
function LabelInput({ value, placeholder, onChange }: {
  value: string; placeholder?: string; onChange: (v: string) => void;
}) {
  return (
    <input className="gnb-ed" value={value} placeholder={placeholder}
      size={Math.max(2, (value || placeholder || '').length + 1)}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

export function TopBar() {
  const { user, isAdmin, logout } = useAuth();
  const { editOn, editAvailable, gridOn, setGridOn, toggleEdit, requestExit, guardNav } = useMainStore();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuSet, patchMenu, menuLoaded] = useMenuSettings(); // 메뉴 관리 (5.2) — 노출·순서·이름
  const { boards, loaded: boardsLoaded } = useBoards(); // 다중 게시판 (5.2) — 게시판 그룹에 동적 반영
  const { map: secMap } = useSections();
  const { links } = useCustomLinks();                    // 커스텀 링크 (v2.0 사용자 요청)                 // 여러 개로 만든 섹션 (v2.0) — 갤러리·다이어리 등
  // 저장 설정 로드 전에는 메뉴·로고를 그리지 않음 — 새로고침 시 기본 구성이 깜빡이는 것 방지 (v1.9)
  const ready = menuLoaded && boardsLoaded;
  const extraEntries = [...boardEntries(boards), ...sectionMenuEntries(secMap), ...linkEntries(links)];
  const builtMenu = ready
    ? buildMenu(menuSet, extraEntries, { loggedIn: !!user, isAdmin })
    : [];

  /* 편집모드 메뉴 이름 편집 (v2.0 사용자 요청) — 상위·하위 이름을 상단바에서 바로 고친다.
     고친 값은 초안으로만 들고 있다가 편집모드 「저장 후 종료」 때 메뉴 트리에 저장,
     「저장하지 않고 종료」면 버린다 (위젯 배치와 같은 규칙). 하위 이름을 비우면 기본 이름으로 돌아간다. */
  const nameEdit = editOn && isAdmin;
  const [names, setNames] = useState<Record<string, string>>({});
  const setName = (k: string, v: string) => setNames(n => ({ ...n, [k]: v }));
  const menu: MenuItem[] = builtMenu.map(m => {
    if (!m.gid) return m;
    const gl = names[gKey(m.gid)];
    return {
      ...m,
      label: gl !== undefined && gl.trim() ? gl : m.label,
      ...(m.children ? {
        children: m.children.map(c => {
          const cl = names[iKey(m.gid!, c.href)];
          return cl !== undefined && cl.trim() ? { ...c, label: cl } : c;
        }),
      } : {}),
    };
  });
  const namesRef = useRef(names);
  namesRef.current = names;
  const treeRef = useRef(menuSet.tree);
  treeRef.current = menuSet.tree;
  useEffect(() => {
    const onEnd = (e: Event) => {
      const save = (e as CustomEvent<{ save: boolean }>).detail?.save;
      const draft = namesRef.current;
      if (save && Object.keys(draft).length) {
        const tree = (treeRef.current ?? defaultTree()).map(g => {
          const gl = draft[gKey(g.id)];
          return {
            ...g,
            ...(gl !== undefined && gl.trim() ? { label: gl.trim() } : {}),
            items: g.items.map(it => {
              const cl = draft[iKey(g.id, it.href)];
              if (cl === undefined) return it;
              if (!cl.trim()) { const { label: _drop, ...rest } = it; void _drop; return rest; }
              return { ...it, label: cl.trim() };
            }),
          };
        });
        patchMenu({ tree });
      }
      setNames({});
    };
    window.addEventListener(EDIT_END_EVENT, onEnd);
    return () => window.removeEventListener(EDIT_END_EVENT, onEnd);
  }, [patchMenu]);
  /** 초안이 있으면 초안, 없으면 지금 보이는 이름 */
  const draftOf = (k: string, shown: string) => names[k] ?? shown;
  const [site, , siteLoaded] = useSiteSettings();    // 로고 텍스트/서브/정렬 (5.2)
  const avatarSrc = useBlobUrl(user?.avatarUrl);     // 프로필 이미지 (마이페이지, v1.9)
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen && !notifOpen) return;
    const close = (e: MouseEvent) => {
      if (!userRef.current?.contains(e.target as Node)) { setMenuOpen(false); setNotifOpen(false); }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen, notifOpen]);

  // 알림 (4.13) — 발생 지점의 커스텀 이벤트로 갱신
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifVer, setNotifVer] = useState(0); // 설정 토글 리렌더용
  useEffect(() => {
    const load = () => { setNotifs(readNotifs()); setNotifVer(v => v + 1); };
    load();
    window.addEventListener(NOTIF_EVENT, load);
    window.addEventListener('storage', load); // 다른 탭
    return () => { window.removeEventListener(NOTIF_EVENT, load); window.removeEventListener('storage', load); };
  }, []);
  /* 서버에 쌓인 내 알림 받아 오기 (v2.0 포크 제보 — 기기 보관이라 남이 남긴 알림이 안 왔다).
     접속할 때 한 번 + 실시간 신호(새 행) + 창에 돌아올 때(30초 간격 제한은 syncNotifs가 건다) */
  useEffect(() => {
    if (!user) return;
    void syncNotifs(user.id, true);
    const off = subscribeTable('notifications', () => void syncNotifs(user.id, true));
    const onFocus = () => void syncNotifs(user.id);
    window.addEventListener('focus', onFocus);
    return () => { off(); window.removeEventListener('focus', onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  const myNotifs = user ? notifs.filter(n => n.toUserId === user.id) : [];
  const unread = myNotifs.filter(n => !n.read);
  // 메뉴 점 — 안 읽은 알림이 가리키는 페이지 (해당 메뉴 뱃지, 4.13)
  const dotHrefs = new Set(unread.map(n => n.href));
  const fmtNd = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const mySet = user ? notifSettings(user.id) : null;
  void notifVer;

  // 편집모드 중에는 이동 전에 종료 확인 (v1.8)
  // 지금 보고 있는 메뉴를 다시 누르면 그 페이지를 새로 불러옴 — 다시 접속하는 느낌 (v1.9 사용자 요청)
  const nav = (href: string) => {
    if (guardNav(href)) return;
    // 같은 메뉴 재클릭 — 브라우저 새로고침 대신 페이지만 처음 상태로 다시 그림 (BGM이 끊기지 않게, v1.9).
    // **쿼리까지 비교해야 한다** (v2.0 사용자 문의로 발견) — 경로만 보면 /board?b=2 에서 /board 를
    // 눌렀을 때 '같은 메뉴'로 착각해 이동이 통째로 막힌다. 여러 개로 만든 게시판·갤러리·다이어리가
    // 전부 같은 경로에 쿼리로 갈리므로, 기본 항목으로 돌아갈 수가 없었다.
    const cur = pathname + window.location.search;
    if (href === cur) { refreshPage(); return; }
    router.push(href);
  };

  // 상위 메뉴 개수 무제한 (v1.9) — 바 폭을 넘치는 항목은 「⋯」 드롭다운으로 자동 이동 (priority+)
  const gnbRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visCount, setVisCount] = useState(menu.length);
  const menuKey = menu.map(m => m.label).join('|') + (nameEdit ? '|ed' : '');
  useEffect(() => {
    const gnbEl = gnbRef.current, mEl = measureRef.current;
    if (!gnbEl || !mEl) return;
    const GAP = 2;
    const compute = () => {
      const avail = gnbEl.clientWidth;
      const kids = Array.from(mEl.children) as HTMLElement[];
      if (avail <= 0) {                            // gnb 숨김(모바일)·미표시 상태 — 측정 불가 시 전체 표시
        setVisCount(kids.length - 1);
        return;
      }
      const moreW = kids[kids.length - 1]?.offsetWidth ?? 40;   // 마지막 = ⋯ 측정용
      const widths = kids.slice(0, -1).map(k => k.offsetWidth);
      const total = widths.reduce((a, w) => a + w, 0) + GAP * Math.max(0, widths.length - 1);
      let count = widths.length;
      if (total > avail) {
        const limit = avail - moreW - GAP;
        let used = 0; count = 0;
        for (const w of widths) {
          if (used + w > limit) break;
          used += w + GAP; count++;
        }
      }
      setVisCount(c => (c === count ? c : count));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(gnbEl); ro.observe(mEl);
    window.addEventListener('resize', compute);
    return () => { ro.disconnect(); window.removeEventListener('resize', compute); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuKey]);
  const visMenu = menu.slice(0, visCount);
  const moreMenu = menu.slice(visCount);

  return (
    <header className="topbar">
      {/* 로고 — 텍스트·서브타이틀·정렬은 환경설정 > 디자인 (5.2) */}
      <div className="brand" onClick={() => nav('/')}>
        {siteLoaded && site.title}
        {siteLoaded && site.subtitle && <small className={`al-${site.align}`}>{site.subtitle}</small>}
      </div>

      <nav className="gnb" ref={gnbRef}>
        {visMenu.map(item =>
          item.children ? (
            <div className="grp" key={item.gid ?? item.label}>
              {nameEdit && item.gid ? (
                <span className="gnb-ed-wrap">
                  <LabelInput value={draftOf(gKey(item.gid), item.label)}
                    onChange={v => setName(gKey(item.gid!), v)} /> ▾
                </span>
              ) : (
                /* 상위 클릭 → 첫 하위 페이지 (v1.8) · 안 읽은 알림이 있는 메뉴에 점 (4.13) */
                <button onClick={() => nav(item.children![0].href)}>
                  {item.label}{item.children.some(c => dotHrefs.has(c.href)) && <small className="nd">●</small>}
                </button>
              )}
              <div className="sub">
                {item.children.map(c => nameEdit && item.gid ? (
                  <div className="sub-ed" key={c.href}>
                    <LabelInput value={draftOf(iKey(item.gid, c.href), c.label)}
                      placeholder={menuLabelFor(c.href, extraEntries) ?? undefined}
                      onChange={v => setName(iKey(item.gid!, c.href), v)} />
                  </div>
                ) : (
                  <button key={c.href} onClick={() => nav(c.href)}>
                    {c.label}{dotHrefs.has(c.href) && <small className="nd">●</small>}
                  </button>
                ))}
              </div>
            </div>
          ) : nameEdit && item.gid ? (
            <span className="gnb-ed-wrap" key={item.gid}>
              <LabelInput value={draftOf(gKey(item.gid), item.label)}
                onChange={v => setName(gKey(item.gid!), v)} />
            </span>
          ) : (
            <button
              key={item.gid ?? item.label}
              className={pathname === item.href ? 'on' : ''}
              onClick={() => nav(item.href!)}
            >
              {item.label}{dotHrefs.has(item.href!) && <small className="nd">●</small>}
            </button>
          )
        )}
        {/* 넘친 상위 메뉴 — ⋯ 드롭다운 (그룹은 캡션+하위, 단독은 바로 이동) */}
        {moreMenu.length > 0 && (
          <div className="grp more">
            <button aria-label="더보기">
              ⋯{moreMenu.some(m => (m.children ?? [{ href: m.href! }]).some(c => dotHrefs.has(c.href!))) && <small className="nd">●</small>}
            </button>
            <div className="sub">
              {moreMenu.map(item =>
                item.children ? (
                  <div className="sub-grp" key={item.gid ?? item.label}>
                    {nameEdit && item.gid ? (
                      <div className="sub-ed">
                        <LabelInput value={draftOf(gKey(item.gid), item.label)}
                          onChange={v => setName(gKey(item.gid!), v)} />
                      </div>
                    ) : <div className="sub-cap">{item.label}</div>}
                    {item.children.map(c => nameEdit && item.gid ? (
                      <div className="sub-ed" key={c.href}>
                        <LabelInput value={draftOf(iKey(item.gid, c.href), c.label)}
                          placeholder={menuLabelFor(c.href, extraEntries) ?? undefined}
                          onChange={v => setName(iKey(item.gid!, c.href), v)} />
                      </div>
                    ) : (
                      <button key={c.href} onClick={() => nav(c.href)}>
                        {c.label}{dotHrefs.has(c.href) && <small className="nd">●</small>}
                      </button>
                    ))}
                  </div>
                ) : nameEdit && item.gid ? (
                  <div className="sub-ed" key={item.gid}>
                    <LabelInput value={draftOf(gKey(item.gid), item.label)}
                      onChange={v => setName(gKey(item.gid!), v)} />
                  </div>
                ) : (
                  <button key={item.gid ?? item.label} onClick={() => nav(item.href!)}>
                    {item.label}{dotHrefs.has(item.href!) && <small className="nd">●</small>}
                  </button>
                ))}
            </div>
          </div>
        )}
        {/* 폭 측정용 사본 (보이지 않음) — 마지막 항목은 ⋯ 버튼 폭 */}
        <div className="gnb gnb-measure" ref={measureRef} aria-hidden>
          {menu.map(item => <button key={item.gid ?? item.label} tabIndex={-1}>{item.label}{item.children && <span> ▾</span>}</button>)}
          <button tabIndex={-1}>⋯</button>
        </div>
      </nav>

      {/* 위젯 추가 — 그리드 토글 왼쪽 (v1.9 사용자 확정: 본문 하단 버튼 대체) */}
      {editOn && pathname === '/' && (
        <button className="btn btn-ghost" style={{ height: 27, padding: '0 11px', fontSize: 10.5, whiteSpace: 'nowrap' }}
          onClick={() => window.dispatchEvent(new Event('ohome-add-widget'))}>＋ 위젯</button>
      )}
      {/* 그리드 토글 — 메인에서 편집모드 켰을 때만 (v1.9) */}
      <KToggle
        className={`grid-chip ${editOn && pathname === '/' ? 'show' : ''}`}
        label="그리드"
        checked={gridOn}
        onChange={setGridOn}
      />
      {/* 편집중 표시 — 클릭 시 종료 확인 (v1.8) */}
      <span className={`edit-flag ${editOn ? 'show' : ''}`} onClick={() => requestExit()}>
        ✎ 편집중
      </span>

      {/* 사용자 영역 — 비로그인: 로그인 버튼 / 로그인: 프로필 드롭다운 (3장 주석, 4.0) */}
      {user ? (
        <div className="user-wrap" ref={userRef}>
          <div className="user-chip" onClick={() => setMenuOpen(o => !o)}>
            {/* 알림 종 (4.13) — 클릭 시 알림 드롭다운 (프로필 메뉴와 별개) */}
            <span className="badge-dot" data-n={String(Math.min(9, unread.length))}
              onClick={e => { e.stopPropagation(); setMenuOpen(false); setNotifOpen(o => !o); }}>
              <BellIcon />
            </span>
            {/* 기본 아바타는 이니셜 없이 단색/그라데이션 (v1.9) */}
            <div className="avatar" style={!avatarSrc && user.avatarColor ? { background: user.avatarColor } : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {avatarSrc && <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
            {user.nickname} <span style={{ fontSize: 9, color: '#8d939d' }}>▾</span>
          </div>
          {/* 알림 드롭다운 — 목록 + 모두 읽음 + 항목별 on/off (4.13) */}
          <div className={`user-menu notif-menu ${notifOpen ? 'open' : ''}`}>
            <div className="nh">
              <b>알림</b>
              {unread.length > 0 && (
                <button className="all" onClick={() => markAllRead(user.id)}>모두 읽음</button>
              )}
              {/* 읽은 알림은 하루 뒤 저절로 사라지지만, 바로 치우고 싶을 때 (v2.0 사용자 요청) */}
              {myNotifs.some(n => n.read) && (
                <button className="all" onClick={() => clearReadNotifs(user.id)}>읽은 알림 정리</button>
              )}
            </div>
            {myNotifs.length === 0 && <p className="empty">알림이 없습니다</p>}
            {myNotifs.slice(0, 12).map(n => (
              <button key={n.id} className={`nt ${n.read ? 'rd' : ''}`}
                onClick={() => { markRead(n.id); setNotifOpen(false); nav(n.href); }}>
                <b>{n.title}</b>
                {n.body && <span>{n.body}</span>}
                <small>{fmtNd(n.date)}</small>
              </button>
            ))}
            {mySet && (
              <div className="nset">
                {(Object.keys(NOTIF_TYPE_LABEL) as NotifType[])
                  .filter(k => k !== 'guest' || isAdmin) // 방명록 알림은 관리자 항목
                  .map(k => (
                    <label key={k} className="row">
                      <span>{NOTIF_TYPE_LABEL[k]}</span>
                      <KToggle checked={mySet[k]} onChange={v => setNotifSetting(user.id, k, v)} />
                    </label>
                  ))}
              </div>
            )}
          </div>
          <div className={`user-menu ${menuOpen ? 'open' : ''}`}>
            <button onClick={() => { setMenuOpen(false); nav('/mypage'); }}>정보수정</button>
            {isAdmin && (
              <>
                {/* 편집모드 항목은 지원 페이지에서만 노출 (편집 중이면 끄기 위해 항상 표시) */}
                {(editAvailable || editOn) && (
                  <button onClick={() => { setMenuOpen(false); toggleEdit(); }}>
                    편집모드 {editOn ? '끄기' : '켜기'}
                  </button>
                )}
                <button onClick={() => { setMenuOpen(false); nav('/settings'); }}>환경설정</button>
              </>
            )}
            <button onClick={() => { setMenuOpen(false); logout(); }}>로그아웃</button>
          </div>
        </div>
      ) : (
        <button className="login-link" onClick={() => nav('/login')}>로그인</button>
      )}
    </header>
  );
}
