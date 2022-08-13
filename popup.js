
class PopupService {
    constructor() {
        this.host = 'http://77.222.52.153:8080';
        this.storage = {
            auth_key: null,
            delay: 10 * 60,
            delay_between: 20
        };
        this.texts = {
            sync: 'Синхронизация с сервером',
            password: 'Введите ключ активации',
            keyPlaceholder: 'КЛЮЧ',
            incorrectPassword: 'Неверно введён ключ',
            delay: 'Задержка между активацией',
            delay_between: 'Задержка между грузами',
            short_hours: 'Ч',
            short_minutes: 'М',
            short_seconds: 'С',
            stop: 'Остановить',
            start: 'Пуск'
        };
        this.statusCodeText = {
            on_settings_get: 'Получение настроек',
            on_cargo_list_request: 'Запрос грузов',
            on_cargo_request: 'Запрос груза',
            on_cargo_commit: 'Сохранение груза',
            on_delay_between: 'Задержка между грузами',
            on_delay: 'Задержка между циклами',
            force_stop: 'Остановлено',
            on_error: 'Произошла ошибка в цикле',
            on_cargo_commit_error: 'Ошибка в подтверждения груза',
        };
        this.state = {
            currentDataSelector: '',
            running: false,
            validated: false,
            validationFailed: false,
            status: 'not_running',
            passwordVisible: false,
            passwordValue: '',
            textInput: {},
        };
        this.clickPreventFunctions = {
            start: this.requestStartProcess,
        };
    }

    init() {
        this.addClickPreventFunction();
        this.addSpeaker();
        this.getSessionValidated();
        this.getSettings();
        this.getRunning();
        this.getStatus();
        this.regenerateDOM();
    }

    getStatus() {
        this.popupSend({command: 'get_status'});
    }

    getRunning() {
        this.popupSend({command: 'get_running'});
    }

    addSpeaker() {
        chrome.runtime.onMessage.addListener(this.onPopupMessage.bind(this));
    }

    onPopupMessage(message) {
        switch (message.command) {
            case 'running': this.onPopupRunningRecived(message); break;
            case 'already_running': this.forceSetRunning(); break;
            case 'validation_failed': this.onValidationError(); break;
            case 'status': this.onStatusRecived(message.value.code); break;
            case 'error': console.log('Error recived:', message); break;
            default: this.popupSend({command: 'error', value: message, reason: 'invalid command'});
        }
    }

    onStatusRecived(code) {
        this.state.status = code;
        console.log('last code:', code);
        if (this.isMainScreen()) this.regenerateDOM();
    }

    onValidationError() {
        this.state.validated = false;
        this.state.validationFailed = true;
        this.storage.auth_key = null;
        chrome.storage.session.set({"session_validated": false}, this.regenerateDOM.bind(this));
        this.regenerateDOM();
    }

    forceSetRunning() {
        this.state.running = true;
        this.regenerateDOM();
    }

    onPopupRunningRecived(message) {
        this.state.running = message.value;
        this.regenerateDOM();
    }

    getSessionValidated() {
        chrome.storage.session.get(['session_validated'], object => {
            this.state.validated = object.session_validated;
            this.regenerateDOM();
        });
    }

    getSettings() {
        chrome.storage.sync.get(['auth_key', 'delay', 'delay_between'], store => {
            this.storage = Object.assign(this.storage, store);
            if (this.storage.auth_key !== null && !this.state.validated) this.requestKey();
            this.regenerateDOM();
        });
    }

    async validate() {
        const object = {auth_key: this.storage.auth_key};
        const response = await fetch(this.host + '/reg', {
            method: 'POST',
            body: JSON.stringify(object),
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        const json = await response.json();
        return json.status;
    }

    requestKey(key) {
        console.log(123123, this.storage.auth_key, this.state.validated);
        setTimeout(async () => {
            const validated = await this.validate();
            if (validated) {
                this.state.validated = true;
                await this.saveSessionValidated();
                await this.saveValidationKey(key);
            } else {
                this.state.validated = false;
                this.state.validationFailed = true;
                this.storage.auth_key = null;
            }
            this.regenerateDOM();
        }, 2e3);
    }

    async saveSessionValidated() {
        await chrome.storage.session.set({"session_validated": true});
    }

    async saveValidationKey(key) {
        await chrome.storage.sync.set({"auth_key": key});
    }

    addClickPreventFunction() {
        window.addEventListener('mousedown', this.onClickPreventMouseDown.bind(this));
        window.addEventListener('mouseup', this.onClickPreventMouseUp.bind(this));
    }

    onClickPreventMouseDown(event) {
        this.state.currentDataSelector = '';
        const element = event.target.matches('[data-click-prevent]') ? event.target : event.target.closest('[data-click-prevent]');
        if (element) this.state.currentDataSelector = element.getAttribute('data-click-prevent');
    }

    onClickPreventMouseUp(event) {
        if (!this.state.currentDataSelector) return;
        const element = event.target.matches('[data-click-prevent]') ? event.target : event.target.closest('[data-click-prevent]');
        if (element && this.state.currentDataSelector == element.getAttribute('data-click-prevent')) {
            this.clickPreventFunctions[this.state.currentDataSelector].call(this);
        }
        this.state.currentDataSelector = '';
    }

    buildDOM() {
        return this.cc('div', {
            id: 'frame',
            children: [
                this.cc('h', {
                    style: 'position: absolute; top: 0; left: 0; z-index:10;',
                    textContent: 'ver: ' + chrome.runtime.getManifest().version
                })
            ]
            .concat(this.isLoadingScreen() ? [this.generateLoadingScreen()] : [])
            .concat(this.isPasswordScreen() ? [this.generatePasswordScreen()] : [])
            .concat(this.isMainScreen() ? [this.generateMainScreen()] : [])
        }, this.ss('#next'));
    }

    isMainScreen() {
        return this.state.validated;
    }

    isLoadingScreen() {
        return this.storage.auth_key && !this.state.validated && !this.state.validationFailed;
    }

    isPasswordScreen() {
        return (this.storage.auth_key === null || this.state.validationFailed) && !this.state.validated;
    }
    
    regenerateDOM() {
        this.ss('#next').innerHTML = '';
        this.buildDOM();
    }

    onPasswordInput(event) {
        this.state.validationFailed = false;
        this.state.passwordValue = event.target.value;
        const oldPasswordInput = this.ss('#password_input');
        this.state.textInput.selectionStart = oldPasswordInput.selectionStart;
        this.state.textInput.selectionEnd = oldPasswordInput.selectionEnd;
        this.regenerateDOM();
        const newPasswordInput = this.ss('#password_input');
        if (!newPasswordInput) return false;
        newPasswordInput.selectionStart = this.state.textInput.selectionStart;
        newPasswordInput.selectionEnd = this.state.textInput.selectionEnd;
        newPasswordInput.focus();
    }

    generateMainScreen() {
        return this.cc('div', {
            className: 'main-screen',
            children: [
                this.cc('div', {
                    className: 'delay-block',
                    children: [
                        this.cc('div', {
                            children: [
                                this.cc('h2', {
                                    textContent: this.texts.delay
                                })
                            ]
                        }),
                        this.cc('div', {
                            className: 'delay-input',
                            "data-storage-name": 'delay',
                            children: [
                                this.generateTimeInput({
                                    hours: {range: [0, 21],  title: this.texts.short_hours, value: new TimeConverter().toTimeDictFromSeconds(this.storage.delay).hours},
                                    minutes: {range: [0, 60], title: this.texts.short_minutes, value: new TimeConverter().toTimeDictFromSeconds(this.storage.delay).minutes},
                                    seconds: {range: [0, 60], title: this.texts.short_seconds, value: new TimeConverter().toTimeDictFromSeconds(this.storage.delay).seconds}
                                })
                            ],
                            onchange: this.onTimeValueChange.bind(this)
                        })
                    ]
                }),
                this.cc('div', {
                    className: 'delay-between-block',
                    children: [
                        this.cc('div', {
                            children: [
                                this.cc('h2', {
                                    textContent: this.texts.delay_between
                                })
                            ]
                        }),
                        this.cc('div', {
                            className: 'delay-input',
                            "data-storage-name": 'delay_between',
                            children: [
                                this.generateTimeInput({
                                    hours: {range: [0, 21],  title: this.texts.short_hours, value: new TimeConverter().toTimeDictFromSeconds(this.storage.delay_between).hours},
                                    minutes: {range: [0, 60], title: this.texts.short_minutes, value: new TimeConverter().toTimeDictFromSeconds(this.storage.delay_between).minutes},
                                    seconds: {range: [0, 60], title: this.texts.short_seconds, value: new TimeConverter().toTimeDictFromSeconds(this.storage.delay_between).seconds}
                                })
                            ],
                            onchange: this.onTimeValueChange.bind(this)
                        })
                    ]
                }),
                this.cc('div', {
                    className: 'status-block',
                    children: [
                        this.cc('div', {
                            className: 'material-symbols-outlined ' + (this.state.running ? 'loading-rotation-straight-animation' : ''),
                            textContent: this.state.running ? 'Cached' : ''
                        }),
                        this.cc('div', {
                            id: 'status-updater',
                            textContent: this.statusCodeText[this.state.status]
                        })
                    ]
                }),
                this.cc('div', {
                    children: [
                        this.cc('button', {
                            className: 'action ',
                            style: 'display: flex; flex-direction: row; gap: 5px;',
                            // onclick: this.requestStartProcess.bind(this),
                            children: [
                                this.cc('div', {
                                    className: "material-symbols-outlined",
                                    textContent: this.state.running ? 'Stop' : 'Play_Arrow'
                                }),
                                this.cc('div', {
                                    textContent: this.state.running ? this.texts.stop : this.texts.start,
                                })
                            ]
                        }, false, function(element) {
                            element.setAttribute('data-click-prevent', 'start');
                        })
                    ]
                })
            ]
        }, false, element => {
            if (this.state.running) Array.from(element.querySelectorAll('.delay-input select')).forEach(select => select.disabled = true);
        });
    }

    requestStartProcess() {
        this.popupSend({command: 'start'});
    }

    popupSend(commandPocket) {
        chrome.runtime.sendMessage(commandPocket);
    }

    onTimeValueChange(event) {
        const dict = this.getTimeFormDict(event.currentTarget);
        const seconds = new TimeConverter().toSecondsFromDict(dict);
        const dataKey = event.currentTarget["data-storage-name"];
        this.storage[dataKey] = seconds;
        console.log(this.storage);
        chrome.storage.sync.set({[dataKey]: seconds});
        this.regenerateDOM();
    }

    getTimeFormDict(element) {
        const formData = new FormData(this.cc('form', {
            children: [element.cloneNode(true)]
        }));
        const dataDict = {};
        for(let [name, value] of formData) {
            dataDict[name] = Number(value);
        }
        return dataDict;
    }

    generateTimeInput(data) {
        return this.cc('div', {
            className: 'time-selector-cell',
            children: Object.keys(data).map(name => {
                return this.cc('div', {
                    className: 'time-cell',
                    children: [
                        this.cc('select', {
                            name: name,
                            children: Array(data[name].range[1] - data[name].range[0]).fill().map((item, index) => {
                                return this.cc('option', {
                                    selected: index + data[name].range[0] === data[name].value,
                                    value: index + data[name].range[0],
                                    textContent: index + data[name].range[0],
                                });
                            }),
                            value: data[name].value,
                            oninput: function(event) {
                                event.target.querySelectorAll('[selected]').forEach(item => item.removeAttribute('selected'));
                                event.target.querySelector(`[value="${event.target.value}"]`).setAttribute('selected', true);
                            }
                        }, false, function(element) {
                            element.querySelector(`[value="${data[name].value}"]`).setAttribute('selected', true);
                        }),
                        this.cc('h2', {
                            textContent: data[name].title
                        })
                    ]
                })
            })
        })
    };
    
    generatePasswordScreen() {
        return this.cc('div', {
            className: 'password-screen',
            children: [
                this.cc('h2', {
                    textContent: this.texts.password
                }),
                this.cc('div', {
                    className: 'input-blank',
                    children: [
                        this.cc('input', {
                            id: 'password_input',
                            style: (this.state.passwordVisible ? '' : '-webkit-text-security: disc;') + (this.state.validationFailed ? 'border: 1px solid red !important;' : ''),
                            placeholder: this.texts.keyPlaceholder,
                            type: 'text',
                            value: this.state.passwordValue,
                            className: 'hidden-text-input',
                            onchange: this.onPasswordInput.bind(this),
                            oninput: this.onPasswordInput.bind(this)
                        }),
                        this.cc('div', {
                            children: [
                                this.cc('div', {
                                    style: 'cursor: pointer;',
                                    className: 'material-symbols-outlined',
                                    textContent: this.state.passwordVisible ? 'Visibility' : 'visibility_off'
                                })
                            ],
                            onclick: () => {
                                this.state.passwordVisible = !this.state.passwordVisible;
                                this.regenerateDOM();
                            }
                        })
                    ]
                }),
                this.cc('div', {
                    style: 'min-height: 12px;',
                    className: 'failSign',
                    textContent: this.state.validationFailed ? this.texts.incorrectPassword : ''
                }),
                this.cc('button', {
                    disabled: !this.state.passwordValue,
                    className: 'action',
                    textContent: 'Далее',
                    onclick: this.commitPassword.bind(this)
                })
            ],
            onkeydown: event => {
                const which = event.code || event.which;
                if (which === 13 || [event.code, event.key].includes('Enter')) this.commitPassword();
            }
        });
    }

    commitPassword() {
        this.state.textInput.selectionStart = 0;
        this.state.textInput.selectionEnd = 0;
        this.storage.auth_key = this.state.passwordValue;
        this.requestKey(this.storage.auth_key);
        this.state.passwordValue = '';
        this.state.passwordVisible = false;
        this.regenerateDOM();
    }

    generateLoadingScreen() {
        return this.cc('div', {
            className: 'loading-screen',
            children: [
                this.cc('h2', {
                    textContent: this.texts.sync
                }),
                this.cc('div', {
                    className: 'loading-animation-holder',
                    children: [
                        this.cc('div', {
                            className: 'loading-rotation-animation',
                            children: [
                                this.cc('div', {                         
                                    style: 'font-size:40px',           
                                    className: 'material-symbols-outlined',
                                    textContent: 'sync'
                                })
                            ]
                        })
                    ]
                })
            ]
        });
    }

    ss(selector, searchIn=document, all=false) {
        return all ? searchIn.querySelectorAll(selector) : searchIn.querySelector(selector);
    }

    cc(tag, options = {}, parent = false, init = false) {
        const children = options.children || [];
        delete options.children;
        const element = Object.assign(document.createElement(tag), options);
        for (const child of children) element.appendChild(child);
        if (init) init(element);
        return parent ? parent.appendChild(element) : element;
    }
}

const PS = new PopupService();
PS.init();





class TimeConverter {
    toSeconds(seconds=0, minutes=0, hours=0) {
        return hours * 60 * 60 + minutes * 60 + seconds;
    }

    toSecondsFromDict(data) {
        return (data.hours ?? 0) * 60 * 60 + (data.minutes ?? 0) * 60 + (data.seconds ?? 0);
    }

    toTimeDictFromSeconds(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds - hours * 3600) / 60);
        const _seconds = Math.floor(seconds - hours * 3600 - minutes * 60);

        return {
            hours: hours,
            minutes: minutes,
            seconds: _seconds,
        }
    }
}