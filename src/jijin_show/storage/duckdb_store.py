from __future__ import annotations

import re
from pathlib import Path

import duckdb

from jijin_show.models import Dataset


_SAFE_TABLE_NAME = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


class DuckDBStore:
    """Simple DuckDB persistence layer for normalized datasets."""

    def __init__(self, database: str | Path) -> None:
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)

    def save_dataset(self, dataset: Dataset, *, mode: str = "replace") -> int:
        """Save a dataset to DuckDB and return written rows.

        mode:
        - replace: replace the whole table.
        - append: append rows to an existing table.
        """
        self._validate_table_name(dataset.name)

        if mode not in {"replace", "append"}:
            raise ValueError("mode must be 'replace' or 'append'")

        with duckdb.connect(str(self.database)) as conn:
            conn.register("dataset_df", dataset.data)
            if mode == "replace":
                conn.execute(f"CREATE OR REPLACE TABLE {dataset.name} AS SELECT * FROM dataset_df")
            else:
                conn.execute(f"CREATE TABLE IF NOT EXISTS {dataset.name} AS SELECT * FROM dataset_df WHERE 1=0")
                conn.execute(f"INSERT INTO {dataset.name} SELECT * FROM dataset_df")
            conn.unregister("dataset_df")

        return dataset.rows

    def table_exists(self, table_name: str) -> bool:
        self._validate_table_name(table_name)
        with duckdb.connect(str(self.database)) as conn:
            result = conn.execute(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ?",
                [table_name],
            ).fetchone()
        return bool(result and result[0] > 0)

    def query(self, sql: str):
        with duckdb.connect(str(self.database)) as conn:
            return conn.execute(sql).fetchdf()

    @staticmethod
    def _validate_table_name(table_name: str) -> None:
        if not _SAFE_TABLE_NAME.match(table_name):
            raise ValueError(f"Unsafe table name: {table_name}")
