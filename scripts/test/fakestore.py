"""An in-memory stand-in for the Firestore client, good enough to run the
real scoring code against.

WHY: scripts/score_week.py holds every scoring rule this pool has — the
confidence payout curve, the per-player bad-weight penalty, perfect weeks,
week winners and runners-up, the Monday-night tiebreak. None of it was
exercised by anything. The Playwright suite drives the UI, and the UI
never runs this file; it renders standings the scorer already wrote. So
the one piece of code that decides who actually wins money was the least
tested thing in the repository.

This double implements exactly the surface score_week.py touches, and
nothing else. It is deliberately small: if a future edit reaches for a
Firestore feature that isn't here, it fails loudly with AttributeError
rather than silently agreeing with itself.

Semantics that matter and are easy to get wrong:
  * .get() on a missing document returns a snapshot whose to_dict() is
    None — score_week.py relies on `or {}` all over, and a double that
    returned {} would hide a real NoneType crash.
  * set(merge=True) deep-merges nested maps, the way Firestore does. A
    shallow merge would make the `weeks` map look fine here and lose data
    in production.
  * set(merge=False) replaces the whole document.
  * Documents are deep-copied in and out, so a caller mutating a dict it
    read cannot reach back into the store. Firestore can't; neither can
    this.
"""

import copy
import operator


_OPS = {
    "==": operator.eq, "!=": operator.ne,
    "<": operator.lt, "<=": operator.le,
    ">": operator.gt, ">=": operator.ge,
}


class Snapshot:
    def __init__(self, doc_id, data, ref=None):
        self.id = doc_id
        self._data = data
        self.reference = ref

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return copy.deepcopy(self._data) if self._data is not None else None

    def get(self, field):
        return (self._data or {}).get(field)


def _deep_merge(base, patch):
    """Firestore's merge=True: nested maps merge, scalars and lists replace."""
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _deep_merge(base[k], v)
        else:
            base[k] = copy.deepcopy(v)
    return base


class DocumentRef:
    def __init__(self, store, path):
        self._store = store
        self.path = path
        self.id = path[-1]

    def collection(self, name):
        return CollectionRef(self._store, self.path + [name])

    def get(self):
        return Snapshot(self.id, self._store.docs.get(tuple(self.path)), self)

    def set(self, data, merge=False):
        key = tuple(self.path)
        if merge and key in self._store.docs:
            _deep_merge(self._store.docs[key], data)
        else:
            self._store.docs[key] = copy.deepcopy(data)
        self._store.writes += 1

    def update(self, data):
        key = tuple(self.path)
        if key not in self._store.docs:
            raise KeyError("update on missing document: " + "/".join(self.path))
        # Dotted field paths, the way firebase-init.js writes roster entries.
        for k, v in data.items():
            target = self._store.docs[key]
            parts = k.split(".")
            for p in parts[:-1]:
                target = target.setdefault(p, {})
            target[parts[-1]] = copy.deepcopy(v)
        self._store.writes += 1

    def delete(self):
        self._store.docs.pop(tuple(self.path), None)
        self._store.writes += 1


class Query:
    def __init__(self, store, path, filters=None, order=None, desc=False, limit=None):
        self._store = store
        self._path = path
        self._filters = filters or []
        self._order = order
        self._desc = desc
        self._limit = limit

    def where(self, field, op, value):
        return Query(self._store, self._path, self._filters + [(field, op, value)],
                     self._order, self._desc, self._limit)

    def order_by(self, field, direction="ASCENDING"):
        return Query(self._store, self._path, self._filters, field,
                     str(direction).upper().startswith("DESC"), self._limit)

    def limit(self, n):
        return Query(self._store, self._path, self._filters, self._order,
                     self._desc, n)

    def stream(self):
        depth = len(self._path)
        rows = []
        for key, data in self._store.docs.items():
            # A document is IN this collection only if its path is exactly
            # one segment longer and shares the prefix — otherwise a
            # subcollection's documents would leak into the parent query.
            if len(key) != depth + 1 or list(key[:depth]) != self._path:
                continue
            if all(_OPS[op](data.get(f), v) for f, op, v in self._filters):
                rows.append((key[-1], data))
        if self._order:
            rows.sort(key=lambda r: r[1].get(self._order), reverse=self._desc)
        else:
            rows.sort(key=lambda r: r[0])      # deterministic, unlike a dict
        if self._limit is not None:
            rows = rows[:self._limit]
        self._store.reads += len(rows)
        return [Snapshot(i, copy.deepcopy(d),
                         DocumentRef(self._store, self._path + [i]))
                for i, d in rows]


class CollectionRef(Query):
    def __init__(self, store, path):
        super().__init__(store, path)

    def document(self, doc_id):
        return DocumentRef(self._store, self._path + [doc_id])


class FakeFirestore:
    """db.collection('x').document('y').collection('z')... """

    def __init__(self):
        self.docs = {}
        self.reads = 0
        self.writes = 0

    def collection(self, name):
        return CollectionRef(self, [name])

    def document(self, path):
        return DocumentRef(self, path.split("/"))

    # ---- test helpers, not part of the Firestore API ----
    def seed(self, path, data):
        self.docs[tuple(path.split("/"))] = copy.deepcopy(data)

    def read(self, path):
        return copy.deepcopy(self.docs.get(tuple(path.split("/"))))

    def batch(self):
        return _Batch(self)


class _Batch:
    """build_snapshot.py writes through a batch."""

    def __init__(self, store):
        self._store = store
        self._ops = []

    def set(self, ref, data, merge=False):
        self._ops.append((ref, data, merge))

    def commit(self):
        for ref, data, merge in self._ops:
            ref.set(data, merge=merge)
        self._ops = []
