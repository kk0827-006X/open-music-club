import LineSidebar from '../../shared/react/LineSidebar.tsx';
import { sections, type UserSection } from './types.ts';
import type { useProfile } from './hooks/use-profile.ts';

export function UserSidebar({
  active,
  expanded,
  role,
  section,
  profile,
  onSectionChange,
}: {
  active: boolean;
  expanded: boolean;
  role: 'admin' | 'user';
  section: UserSection;
  profile: ReturnType<typeof useProfile>;
  onSectionChange: (section: UserSection) => void;
}) {
  const {
    nickname,
    avatarUrl,
    avatarSrc,
    avatarFeedback,
    avatarInputRef,
    onAvatarChange,
    chooseAvatar,
  } = profile;
  const visibleSections =
    role === 'admin'
      ? [...sections, { id: 'admin' as const, label: '申请审核', english: 'ADMINISTRATION' }]
      : sections;
  const changeSection = onSectionChange;
  return (
    <>
      <p className="user-eyebrow">MEMBER ARCHIVE / 个人音乐空间</p>
      <div className="user-profile">
        <button
          type="button"
          className="user-avatar"
          data-user-avatar-choose
          aria-label="选择本地图片作为头像"
          onClick={chooseAvatar}
        >
          <span data-user-avatar-placeholder hidden={Boolean(avatarUrl)}>
            OMC
          </span>
          <img data-user-avatar-image hidden={!avatarUrl} src={avatarSrc} alt="用户头像" />
          <b>更换头像</b>
          <i></i>
        </button>
        <input
          ref={avatarInputRef}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          data-user-avatar-file
          aria-label="选择头像图片"
          tabIndex={-1}
          onChange={(event) => void onAvatarChange(event)}
        />
      </div>
      <div className="user-identity">
        <small data-user-nickname>{nickname}</small>
        <p data-user-avatar-feedback role="status">
          {avatarFeedback}
        </p>
      </div>
      <LineSidebar
        ariaLabel="个人音乐分类"
        items={visibleSections.map((item) => item.label)}
        activeIndex={visibleSections.findIndex((item) => item.id === section)}
        enabled={active && expanded}
        showIndex={false}
        markerLength={26}
        markerGap={12}
        maxShift={12}
        itemGap={16}
        fontSize={0.83}
        className="member-line-sidebar"
        getItemProps={(index) => ({
          'data-user-tab': visibleSections[index].id,
          title: visibleSections[index].label,
        })}
        renderLabel={(label, index) => (
          <>
            <strong>{label}</strong>
            <small>{visibleSections[index].english}</small>
          </>
        )}
        onItemClick={(index) => changeSection(visibleSections[index].id)}
      />
      <p className="user-sidebar-foot">
        <i></i> YOUR MUSIC, YOUR ARCHIVE
        <br />
        音乐从这里开始归档
      </p>
    </>
  );
}
