import type { ProjectRole } from '../engine/types';
import { callApi } from './api';
import { supabase } from './supabaseRepo';

/**
 * Sharing a schedule, and leaving Marga. Each call is a database function that
 * checks who is asking before doing anything (supabase/migrations/0004), so the
 * rules hold whatever the interface does.
 */

export interface Person {
  userId: string;
  email: string;
  displayName: string | null;
  role: ProjectRole;
}

export type ShareRole = 'editor' | 'viewer';

function message(error: { message: string; code?: string }): string {
  if (error.code === '42501') return "You don't have permission to do that.";
  return error.message;
}

export async function listPeople(projectId: string): Promise<{ people: Person[]; error: string | null }> {
  const { data, error } = await supabase().rpc('project_people', { p_id: projectId });
  if (error) return { people: [], error: message(error) };
  return {
    people: (data ?? []).map((r: { user_id: string; email: string; display_name: string | null; role: ProjectRole }) => ({
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
    })),
    error: null,
  };
}

export async function shareWith(projectId: string, email: string, role: ShareRole): Promise<string | null> {
  const { data, error } = await supabase().rpc('share_project', { p_id: projectId, p_email: email, p_role: role });
  if (error) return message(error);
  const result = (data ?? {}) as { ok?: boolean; reason?: string };
  if (result.ok) return null;
  if (result.reason === 'self') return 'You already own this schedule.';
  return 'No Marga account uses that email. Ask them to sign up first, then share again.';
}

export async function setRole(projectId: string, userId: string, role: ShareRole): Promise<string | null> {
  const { error } = await supabase().rpc('set_member_role', { p_id: projectId, p_user: userId, p_role: role });
  return error ? message(error) : null;
}

/** Remove someone from a schedule, or — with your own id — leave it. */
export async function removePerson(projectId: string, userId: string): Promise<string | null> {
  const { error } = await supabase().rpc('remove_member', { p_id: projectId, p_user: userId });
  return error ? message(error) : null;
}

/** Schedules you own and how many of them anyone else can reach. */
export async function ownedSummary(): Promise<{ owned: number; shared: number }> {
  const { data: session } = await supabase().auth.getSession();
  const me = session.session?.user.id ?? '';
  const { data: mine } = await supabase()
    .from('project_members')
    .select('project_id')
    .eq('user_id', me)
    .eq('role', 'owner');
  const owned = (mine ?? []).map((m) => m.project_id as string);
  if (!owned.length) return { owned: 0, shared: 0 };
  const { data: others } = await supabase().from('project_members').select('project_id').in('project_id', owned).neq('role', 'owner');
  return { owned: owned.length, shared: new Set((others ?? []).map((m) => m.project_id as string)).size };
}

/**
 * Through the server, not the delete_my_account RPC: the server cancels any
 * Stripe subscription first, and keeps the account if it can't (so nobody is
 * deleted but still billed). The RPC refuses subscribers for that reason.
 */
export async function deleteMyAccount(): Promise<string | null> {
  const { status, data } = await callApi('/api/account/delete');
  return status === 200 ? null : (data.error ?? `Could not delete your account (${status}).`);
}
