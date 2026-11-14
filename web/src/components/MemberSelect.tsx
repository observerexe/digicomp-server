import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../api/client';
import { useAuth } from '../auth/AuthProvider';

/**
 * Active members for staff forms. `excludeSelf` hides the moderator from the
 * list where the API forbids acting on oneself (awarding, disciplining);
 * admin has no such limit.
 */
export function MemberSelect(props: { id: string; value: string; onChange: (id: string) => void; allowAll?: boolean; excludeSelf?: boolean; label: string }) {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['users', 'staff-list'],
    queryFn: () => unwrap(api.GET('/api/users', { params: { query: { limit: '100', active: 'true' } } })),
  });
  const people = (q.data?.items ?? []).filter((u) => !props.excludeSelf || user?.role === 'admin' || u.id !== user?.id);
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">{props.allowAll ? 'Усі' : q.isPending ? 'Завантажуємо…' : 'Виберіть учасника'}</option>
        {people.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
            {u.position ? ` — ${u.position}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
