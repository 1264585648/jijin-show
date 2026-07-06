.PHONY: install assets collect-all overview lint

install:
	pip install -e .

assets:
	jijin-show assets

collect-all:
	jijin-show collect all

overview:
	jijin-show overview

lint:
	ruff check src scripts
