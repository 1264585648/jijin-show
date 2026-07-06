from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import pandas as pd


@dataclass(frozen=True)
class Dataset:
    """A normalized dataset ready for storage or frontend export."""

    name: str
    data: pd.DataFrame
    source: str
    fetched_at: datetime
    status: str = "fresh"

    @property
    def rows(self) -> int:
        return len(self.data.index)
