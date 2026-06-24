# Build the OpenSolvency C client + example. Requires libcurl (libcurl4-openssl-dev
# / curl-devel / `brew install curl`).
CFLAGS ?= -O2 -Wall -Wextra -std=c11
LDLIBS ?= -lcurl

example: example.c opensolvency.c opensolvency.h
	$(CC) $(CFLAGS) example.c opensolvency.c -o example $(LDLIBS)

# Syntax-only check of the library (no link, still needs curl headers).
check: opensolvency.c opensolvency.h
	$(CC) $(CFLAGS) -fsyntax-only opensolvency.c

clean:
	rm -f example

.PHONY: check clean
