//! Hand-over slot between threads that keeps only the newest value.

use std::sync::{Arc, Mutex};

/// Shared slot holding the newest value that was not taken yet.
pub struct Latest<T>(Arc<Mutex<Option<T>>>);

impl<T> Clone for Latest<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<T> Default for Latest<T> {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }
}

impl<T> Latest<T> {
    /// Stores `value`, replacing a value that was not taken yet.
    pub fn put(&self, value: T) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = Some(value);
        }
    }

    /// Takes the stored value, if any.
    pub fn take(&self) -> Option<T> {
        self.0.lock().ok().and_then(|mut slot| slot.take())
    }
}

#[cfg(test)]
mod tests {
    use super::Latest;

    #[test]
    fn take_returns_only_the_newest_value_once() {
        let latest = Latest::default();
        latest.put(1);
        latest.clone().put(2);
        assert_eq!(latest.take(), Some(2));
        assert_eq!(latest.take(), None);
    }
}
