import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, orderBy, limit } from '../lib/db';
import { Card, Button, Badge, Empty, Loading, ConfirmDialog, useToast } from '../components/ui';
import { deleteOne } from '../lib/remove';
import { audit } from '../lib/db';
import { errorText } from './Rosa';
import { CALLUP_STATUS, fmtShort, fmtTime } from '../lib/format';
import { can } from '../lib/permissions';

const TONE = {
  bozza: 'grey', da_revisionare: 'orange', pubblicata: 'green', condivisa: 'green',
  parzialmente_confermata: 'orange', completamente_confermata: 'green', chiusa: 'grey', annullata: 'red'
};

export default function Convocazioni() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const q = useMemo(() => [orderBy('matchDate', 'desc'), limit(40)], []);
  const { data: callups, loading } = useCollection('callups', q);
  const canDraft = can(user?.role, 'callup.draft');
  const canDelete = can(user?.role, 'callup.delete');
  const [removing, setRemoving] = useState(null);
  const toast = useToast();

  if (loading) return <Loading />;

  return (
    <>
      <div className="pagehead">
        <div><h1>Convocazioni</h1><p>{callups.length} distinte in archivio</p></div>
        {canDraft && <Button size="sm" onClick={() => navigate('/convocazioni/nuova')}>＋ Nuova</Button>}
      </div>

      {callups.length === 0 ? (
        <Card><Empty title="Nessuna convocazione"
          action={canDraft && <Button onClick={() => navigate('/convocazioni/nuova')}>Prepara la prima convocazione</Button>}>
          Da qui prepari la lista, generi il messaggio WhatsApp e raccogli le conferme.
        </Empty></Card>
      ) : (
        <div className="plist">
          {callups.map((c) => {
            const total = (c.players || []).length;
            const conf = (c.confirmed || []).length;
            return (
              <div key={c.id} className="prow">
                <span className="prow__num" onClick={() => navigate(`/convocazioni/${c.id}`)} style={{ cursor: 'pointer' }}>{total}</span>
                <span className="prow__body" onClick={() => navigate(`/convocazioni/${c.id}`)} style={{ cursor: 'pointer' }}>
                  <span className="prow__name">vs {c.opponent}</span>
                  <span className="prow__meta">
                    <span>{fmtShort(c.matchDate)} {fmtTime(c.matchDate)}</span>
                    <span>{conf}/{total} conferme</span>
                    {c.version > 1 && <span>v{c.version}</span>}
                  </span>
                </span>
                <Badge tone={TONE[c.status] || 'grey'}>{CALLUP_STATUS[c.status] || c.status}</Badge>
                {canDelete && <button className="iconbtn" aria-label="Elimina convocazione" onClick={() => setRemoving(c)}>🗑</button>}
              </div>
            );
          })}
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title="Eliminare la convocazione?"
          destructive
          confirmLabel="Elimina"
          message={`Convocazione contro ${removing.opponent} con ${(removing.players || []).length} giocatori. Sparisce anche lo storico delle versioni. La partita resta in calendario.`}
          onConfirm={async () => {
            try {
              await deleteOne('callups', removing.id);
              await audit(user, 'callup.delete', removing.id, { opponent: removing.opponent });
              toast('Convocazione eliminata');
            } catch (e) { toast(errorText(e), 'error'); }
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}
