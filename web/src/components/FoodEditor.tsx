'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { saveFoodMacros, type SaveState } from '@/app/food/actions';
import type { FoodRow } from '@/lib/backend';
import { n } from '@/lib/num';
import { int } from '@/lib/format';

/**
 * Correcting a food's macros in place.
 *
 * Collapsed by default. The review queue's job is still to be read at a glance — a screen of
 * eleven open forms would bury the ranking that tells you which one is worth fixing.
 *
 * The warning is not boilerplate. Meals read macros THROUGH the food, so saving here changes
 * every day this food has ever appeared on, including totals you have already looked at. That
 * is the intended behaviour of the catalog and it should still be said out loud before you
 * press the button.
 */
export function FoodEditor({ row, children }: { row: FoodRow; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  // The form — and its useActionState — only exists once opened.
  //
  // This used to be one component, which meant every row on the screen mounted an action-state
  // hook it would probably never use. At a dozen foods that is invisible; at a few hundred it is
  // hundreds of hooks to hydrate for one row you might tap. A collapsed row is now just a button.
  //
  // The ROW is that button, rather than an amber call-to-action under each one: a stack of those
  // competed with the ordering that tells you which food is worth fixing, and the row is a far
  // bigger tap target than any control that would fit there.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="pressable"
        aria-label={`Correct macros for ${row.name}`}
        style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }}
      >
        {children}
      </button>
    );
  }

  return (
    <EditForm row={row} onClose={() => setOpen(false)}>
      {children}
    </EditForm>
  );
}

function EditForm({
  row,
  children,
  onClose,
}: {
  row: FoodRow;
  children: ReactNode;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveFoodMacros, {
    status: 'idle',
  });

  // Collapse on the TRANSITION to saved, not whenever the status happens to be 'saved'.
  // useActionState keeps the last result forever, so reacting to the value itself would slam
  // the form shut the moment you reopened it to make a second correction.
  const [seenStatus, setSeenStatus] = useState(state.status);
  if (state.status !== seenStatus) {
    setSeenStatus(state.status);
    // No confirmation banner: revalidation re-renders the row from the database, so the new
    // numbers appearing above ARE the confirmation.
    if (state.status === 'saved') onClose();
  }

  return (
    <form action={action}>
      {children}
      <input type="hidden" name="food_id" value={row.id} />
      <input type="hidden" name="name" value={row.name} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 12 }}>
        <Field label="kcal" name="calories" value={n(row.calories)} />
        <Field label="P" name="protein_g" value={n(row.protein_g)} />
        <Field label="C" name="carbs_g" value={n(row.carbs_g)} />
        <Field label="F" name="fat_g" value={n(row.fat_g)} />
      </div>

      <p style={{ margin: '10px 0 0', fontSize: 'var(--t-cap)', color: 'var(--ink-faint)', lineHeight: 1.5 }}>
        Per one {row.unit_label ?? 'serving'}. Saving updates all {row.times_eaten} meals using this
        food, including past days — and marks it high confidence.
      </p>

      {state.error ? (
        <p className="selectable" style={{ margin: '8px 0 0', fontSize: 'var(--t-cap)', color: 'var(--fault)' }}>
          {state.error}
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button
          type="submit"
          disabled={pending}
          className="cap pressable"
          style={{
            minHeight: 44,
            padding: '0 18px',
            border: `1px solid ${pending ? 'var(--rule)' : 'var(--signal)'}`,
            borderRadius: 2,
            color: pending ? 'var(--ink-faint)' : 'var(--signal)',
          }}
        >
          {pending ? 'Saving' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="cap pressable"
          style={{ minHeight: 44, padding: '0 14px', color: 'var(--ink-faint)' }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({ label, name, value }: { label: string; name: string; value: number | null }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="cap" style={{ color: 'var(--ink-faint)', display: 'block', marginBottom: 4 }}>
        {label}
      </span>
      <input
        name={name}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        defaultValue={value === null ? '' : int(value)}
        className="mono"
        style={{
          width: '100%',
          minHeight: 44,
          background: 'var(--panel)',
          border: '1px solid var(--rule)',
          borderRadius: 2,
          color: 'var(--ink)',
          fontSize: 'var(--t-base)',
          padding: '0 8px',
        }}
      />
    </label>
  );
}
