function StartSqlEditor() {
$('<div>')
    .appendTo(document.body)
    .sql({autoOpen  : false,
    title     : null,
    cmdOwner  : null
    })
    .sql('open');
}

function StartSqlEditorWithTitle(title, cmd) {
$('<div>')
    .appendTo(document.body)
    .sql({autoOpen  : false,
    title     : title,
    cmdOwner  : null,
    cmdFlat   : cmd,
    })
    .sql('open');
}

function insertAtCursor(myField, myValue) {
  //IE support
  if (document.selection) {
    var temp;
    myField.focus();
    sel = document.selection.createRange();
    temp = sel.text.length;
    sel.text = myValue;
    if (myValue.length == 0) {
      sel.moveStart('character', myValue.length);
      sel.moveEnd('character', myValue.length);
    } else {
      sel.moveStart('character', -myValue.length + temp);
    }
    sel.select();
  }
  //MOZILLA/NETSCAPE support
  else if (myField.selectionStart || myField.selectionStart == '0') {
    var startPos = myField.selectionStart;
    var endPos = myField.selectionEnd;
    myField.value = myField.value.substring(0, startPos) + myValue + myField.value.substring(endPos, myField.value.length);
    myField.selectionStart = startPos + myValue.length;
    myField.selectionEnd = startPos + myValue.length;
  } else {
    myField.value += myValue;
  }
}

(function( $ ) {    
  var DEFAULT_COUNTER = 0;
  $.widget( "dderl.sql", $.ui.dialog, {

    _cmdOwner       : null,
    _dlg            : null,
    _editDiv        : null,
    _footerDiv      : null,
    _footerWidth    : 0,
    _txtlen         : null,
    _fnt            : null,
    _fntSz          : null,

    _flatTb         : null,
    _prettyTb       : null,
    _boxDiv         : null,

    _modCmd         : "",
    _cmdFlat        : "",
    _cmdPretty      : "",
    _boxJson        : {},  
    _boxBg          : null,
    _history        : null,
    _historySelect  : null,
    _cmdChanged     : false,
    _reloadBtn      : null,

    // private event handlers
    _handlers       : { parsedCmd : function(e, _parsed) {
                            var self = e.data; 
                            self._checkParsed(_parsed);
                            self._renderParsed(_parsed);
                        },
                        reloadParsedCmd : function(e, _parsed) {
                            var self = e.data;
                            self._reloadParsedCmd(_parsed);
                        }
                      },

    _toolsBtns      : {'Validate SQL'               : { typ : 'btn', icn : 'refresh',       clk : '_toolBarValidate'        },
                       'Execute fetch first block'  : { typ : 'btn', icn : 'play',          clk : '_toolBarTblReload'       },
                       'Execute fetch to end'       : { typ : 'btn', icn : 'seek-end',      clk : '_toolBarTblFetch2End'    },
                       'Execute fetch tail mode'    : { typ : 'btn', icn : 'fetch-tail',    clk : '_toolBarTblFetchNTail'   },
                       'Execute tail mode only'     : { typ : 'btn', icn : 'fetch-only',    clk : '_toolBarTblTailOnly'     },
                       ''                           : { typ : 'sel',                        clk : '_toolBarChangeSql'       }},

    // These options will be used as defaults
    options: {
        // dialog options default override
        height          : 250,
        width           : 336,
        minHeight       : 50,
        minWidth        : 100,
        resizable       : true,
        modal           : false,
        title           : "_Set TITLE here_",
        canMinimize     : true,
        canMaximize     : true,
        closeOnEscape   : false,
        clear           : null,
        toolBarHeight   : 27,
        open            : function(e,ui) {
                          },
        focus           : function(e,ui) {},
        close           : function() {
                            $(this).dialog('destroy');
                            $(this).remove();
                          },
        cmdFlat         : "",
        cmdOwner        : null,
        history         : []
    },
 
    _refreshHistoryBoxSize: function() {
        var self = this;
        // footer total width
        var childs = self._footerDiv.children();
        var totWidth = 0;
        for(var i = 0; i + 1 < childs.length; ++i) {
            totWidth += $(childs[i]).width();
        }
        self._historySelect.css('width', self._footerDiv.width() - totWidth);
    },

    // Set up the widget
    _create: function() {
        var self = this;

        self._history = [];

        self._fnt = $(document.body).css('font-family');
        self._fntSz = $(document.body).css('font-size');

        // preserve some options
        if(self.options.cmdOwner    !== self._cmdOwner)     self._cmdOwner  = self.options.cmdOwner;
        if(self.options.cmdFlat     !== self._cmdFlat)      self._cmdFlat   = self.options.cmdFlat;
        if(self.options.history     !== self._history)      self._history   = self.options.history;
        if(self.options.title       !== self._title) {
            if(self.options.title === null) {
                self.options.title = 'Query'+DEFAULT_COUNTER+'.sql';
                ++DEFAULT_COUNTER;
            }
            self._title = self.options.title;
        }

        // dialog elements

        // field for text width measurement in pixels
        // added to document.body once
        if($('#txtlen').length === 0) {
            self._txtlen =
                $('<span>')
                .attr('id', 'txtlen')
                .css('visibility', 'hidden')
                .css('font-family', self._fnt)
                .css('font-size', self._fntSz)
                .appendTo(document.body);
        } else {
            self._txtlen =
                $('#txtlen')
                .css('font-family', self._fnt)
                .css('font-size', self._fntSz);
        }

        //
        // editor container
        //

        var flatBg      = 'rgb(240,240,255)';
        var prettyBg    = 'rgb(255,240,240)';
        self._boxBg     = 'rgb(240,255,240)';

        var sqlKeyHandle = function(e, self, _cmd) {
            if(e.type == "keydown") {
                if((e.keyCode || e.which) == 9) {
                    e.preventDefault();
                    insertAtCursor(self, "  ");
                }

                var that = e.data;
                _cmd = $(self).val();
                that._modCmd = _cmd;
            }
        };

        self._flatTb =
            $('<textarea autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">')
            .addClass('sql_text_flat')
            .on('keydown keyup click blur focus change paste', this, function(e) {
                sqlKeyHandle(e, this, e.data._cmdFlat);
            })
            .val(self._cmdFlat);

        self._prettyTb =
            $('<textarea autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">')
            .attr('wrap', 'off')
            .addClass('sql_text_pretty')
            .on('keydown keyup click blur focus change paste', this, function(e) {
                sqlKeyHandle(e, this, e.data._cmdPretty);
            })
            .val(self._cmdPretty);

        self._boxDiv =
            $('<div>')
            .addClass('sql_text_box')
            .css('font-family', self._fnt);

        self._editDiv =
            $('<div>')
            .append(
              $('<ul>'
              +'  <li style="background:'+flatBg+'"><a href="#tabflat">Flat</a></li>'
              +'  <li style="background:'+prettyBg+'"><a href="#tabpretty">Pretty</a></li>'
              +'  <li style="background:'+self._boxBg+'"><a href="#tabbox">Box</a></li>'
              +'</ul>')
            )
            .append(
              $('<div>')
              .attr('id','tabflat')
              .append(self._flatTb)
            )
            .append(
              $('<div>')
              .attr('id','tabpretty')
              .append(self._prettyTb)
            )
            .append(
              $('<div>')
              .css('background-color', self._boxBg)
              .attr('id','tabbox')
              .append(self._boxDiv)
            )
            .css('position', 'absolute')
            .css('overflow', 'hidden')
            .css('top', '0')
            .css('left', '0')
            .css('right', '0')
            .css('bottom', self.options.toolBarHeight+'px')
            .tabs()
            .on("tabsactivate", function(event, ui) {
                var shouldReparse = false;
                self._setTabFocus();

                console.log("en tab activate the cmd " + self._modCmd);
                console.log(self);
                if(ui.oldPanel.attr('id') !== ui.newPanel.attr('id') && self._modCmd) {
                    ajaxCall(self, '/app/parse_stmt', {parse_stmt: {qstr:self._modCmd}},'parse_stmt','parsedCmd');
                }
            })
            .removeClass('ui-corner-all')
            .appendTo(self.element);

        var tabTitles = self._editDiv.find('ul');

        tabTitles
            .removeClass('ui-corner-all')
            .css('border-top', 'none')
            .css('border-left', 'none')
            .css('border-right', 'none');
        self._editDiv.find('li').removeClass('ui-corner-top');

        var titleHeight = tabTitles.height();
        $('#tabflat, #tabpretty, #tabbox').css('top', titleHeight+'px');

        // toolbar container
        self._footerDiv = $('<div>').appendTo(self.element);

        // need the max footer with to set as dlg minWidth
        self._createDlgFooter();
        self._createDlg();

        // setting up the event handlers last to aid debugging
        self._setupEventHandlers();
    },

    _init: function() {
        var self = this;

        // default dialog open behavior
    	if (self.options.autoOpen)
            self._dlg.dialog("open");

        if (undefined != self._cmdFlat && self._cmdFlat.length > 0) {
            self._modCmd = self._cmdFlat;
            ajaxCall(self, '/app/parse_stmt', {parse_stmt: {qstr:self._cmdFlat}}, 'parse_stmt', 'parsedCmd');
        }
    },

    _setupEventHandlers: function() {
        // make this as context to private event handler functions
        // and register for named events
        for(var fun in this._handlers)
            this.element.on(fun, null, this, this._handlers[fun]);
    },

    _createDlgFooter: function() {
        var self = this;

        // footer for the toolbar
        self._footerDiv
            .css('height', self.options.toolBarHeight+'px')
            .css('position', 'absolute')
            .css('left', '0')
            .css('right', '0')
            .css('bottom', '0')
            .css('overflow', 'hidden');

        self._footerWidth = self._addBtngrpToDiv(self._footerDiv);
    },

    _addBtngrpToDiv: function(toolDiv) {
        var self = this;

        for(btnTxt in self._toolsBtns) {
            var elm = self._toolsBtns[btnTxt];

            var toolElmFn = function(e) {
                var self = e.data;
                var _btnTxt = $(this).text();
                var fName = self._toolsBtns[_btnTxt].clk;
                var f = $.proxy(self[fName], self);
                if($.isFunction(f))
                    f();
                else
                    throw('['+self.options.title+'] toolbar '+_btnTxt+' has unimplimented cb '+fName);
            };

            var inph = self.options.toolBarHeight;
// TODO jQ 1.9 deprecated $.browser find work around
//            if($.browser.msie) inph -= 2;

            if (self._toolsBtns[btnTxt].typ === 'btn') {
                $('<button>')
                    .text(btnTxt)
                    .button({icons: {primary: 'ui-icon-' + elm.icn}, text: false})
                    .css('height', this.options.toolBarHeight+'px')
                    .click(self, toolElmFn)
                    .appendTo(toolDiv);
            } else if (self._toolsBtns[btnTxt].typ === 'sel') {
                var sel = $('<select>')
                    .width(100)
                    .css('margin', '0px 0px 0px 0px')
                    .addClass('ui-button ui-widget ui-state-default ui-button-text-only ui-corner-right')
                    .css('height', this.options.toolBarHeight+'px')
                    .css('text-align', 'left')
                    .appendTo(toolDiv);

                for(var i = 0; i < self._history.length; ++i) {
                    var optionToAdd = $('<option>')
                        .text(self._history[i])
                        .click(function (evt) {
                            evt.preventDefault();
                            self.showCmd($(this).text());
                        });
                    sel.append(optionToAdd);
                }
                self._historySelect = sel;
            }
        }
        
        toolDiv
            .buttonset()
            .css('height', (self.options.toolBarHeight)+'px');

        // footer total width
        var childs = toolDiv.children();
        var totWidth = 0;
        for(var i = 0; i < childs.length; ++i) {
            totWidth += $(childs[i]).width();
        }
        return totWidth;
    },
  
    /*
     * Toolbar callbak functions
     */
    _toolBarValidate: function() {
        ajaxCall(this, '/app/parse_stmt', {parse_stmt: {qstr:this._modCmd}},'parse_stmt','parsedCmd');
    },
    _toolBarTblReload: function() {
        this._loadTable('>');
    },
    _toolBarTblFetch2End: function() {
        this._loadTable('>|');
    },
    _toolBarTblFetchNTail: function() {
        this._loadTable('>|...');
    },
    _toolBarTblTailOnly: function() {
        this._loadTable('...');
    },
    _toolBarChangeSql: function() {
    },

    _loadTable: function(button) {
        self._reloadBtn = button;
        ajaxCall(this, '/app/parse_stmt', {parse_stmt: {qstr:this._modCmd}},'parse_stmt','reloadParsedCmd');
    },

    _reloadParsedCmd: function(_parsed) {
        var initOptions = {
            title          : this._title,
            autoOpen       : false,
            dderlConn      : dderlState.connection,
            dderlAdapter   : dderlState.adapter,
            dderlStartBtn  : self._reloadBtn,
            dderlCmdStrs   : this._history,
            dderlSqlEditor : this._dlg
        };
        this._renderParsed(_parsed);
        this._modCmd = this._cmdFlat;
        if(null === this._cmdOwner) {
            this._cmdOwner = $('<div>')
                .appendTo(document.body)
                .table(initOptions)
                .table('cmdReload', this._modCmd, self._reloadBtn);
        } else if(this._cmdOwner.hasClass('ui-dialog-content')) {
            this._cmdOwner.table('cmdReload', this._modCmd, self._reloadBtn);
        } else {
            this._cmdOwner.appendTo(document.body).table(initOptions)
                .table('cmdReload', this._modCmd, self._reloadBtn);
        }
    },

    _addToHistory: function(sql) {
        var self = this;
        if(self._history.indexOf(sql) == -1) {
            self._history.unshift(sql);
            self._historySelect.prepend(
                $('<option>').text(sql)
                    .click(function (evt) {
                        evt.preventDefault();
                        self.showCmd($(this).text());
                    }));
        }
    },

    _setTabFocus: function() {
        var self = this;
        var selected = self._editDiv.tabs("option", "active");

        if(selected == 0) {
            self._flatTb.focus();
            textBox = self._flatTb[0];
            textBox.selectionStart = textBox.selectionEnd = textBox.value.length;
        } else if(selected == 1) {
            self._prettyTb.focus();
            textBox = self._prettyTb[0];
            textBox.selectionStart = textBox.selectionEnd = textBox.value.length;
        } else if(selected == 2) {
            self._boxDiv.focus();
        }
    },

    ////////////////////////////

    /*
     * ajaxCall success handlers
     */
      // TODO: Enable error display when they are minimal
    _checkParsed: function(_parsed) { /*
        var error = ''
        if(_parsed.hasOwnProperty('boxerror'))      error += 'Box Error - <br>' + _parsed.boxerror + '<br>';
        if(_parsed.hasOwnProperty('prettyerror'))   error += 'Pretty Error - <br>' + _parsed.prettyerror + '<br>';
        if(_parsed.hasOwnProperty('flaterror'))     error += 'Flat Error - <br>' + _parsed.flaterror + '<br>';
        if(_parsed.hasOwnProperty('error'))         error = 'Parser error - <br>' + _parsed.error + '<br>';

        if (error.length > 0)
            alert_jq(error);*/
    },
    _renderParsed: function(_parsed) {
        var textBox;

        this._setTabFocus();

        if(_parsed.hasOwnProperty('sqlbox')) {
            this._boxJson = _parsed.sqlbox;
            this._boxDiv.html('');
            this._boxing(this._boxJson, this._boxDiv.width()).div.appendTo(this._boxDiv);
        }
        if(_parsed.hasOwnProperty('flat')) {
            this._flatTb.val(_parsed.flat);
            this._cmdFlat = this._flatTb.val();
        }
        if(_parsed.hasOwnProperty('pretty')) {
            this._prettyTb.val(_parsed.pretty);
            this._cmdPretty = this._prettyTb.val();
            if(!this._cmdChanged) {
                this._cmdChanged = true;
                this._editDiv.tabs("option", "active", 1);
                this._setTabFocus();
            }
        }
    },

    _leaf_box: function (bx, collapsed, nametxt, alltxt, children, maxwidth, parent) {
        var self = this;
        var edit = $('<textarea autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">')
            .addClass('boxEdit')
            .width(maxwidth)
            .attr('rows', 2)
            .val(alltxt);
        var name = $('<span>')
            .addClass('boxName')
            .text(nametxt);
    
        bx.append(edit);
        bx.append(name);
        bx.data("oldText", alltxt);

        var childrendiv = null;
        if(children.length > 0) {
            childrendiv = $('<div>')
                .width(maxwidth)
                .addClass('boxChildren');
            bx.append(childrendiv);
        }
    
        for(var i = 0; i < children.length; ++i) {
            childrendiv.append(children[i]);
        }
    
        edit.dblclick(function(e) {
            e.preventDefault();
            e.stopPropagation();
            edit.css('display','none');
            if(bx.data("oldText") != edit.val()) {
                bx.data("oldText", edit.val());
                name.text(edit.val());
                nametxt = edit.val();
                alltxt = edit.val();
                // delete all the children.
                if(childrendiv) {
                    console.log(childrendiv);
                    childrendiv.remove();
                }
                if(parent) {
                    var updateFunc = parent.data("updateFunc");
                    updateFunc();
                }
            }
            name.css('display','inline');
            if(childrendiv) childrendiv.css('display','inline');
        });
    
        var dblClkFn = function(e) {
            e.preventDefault();
            e.stopPropagation();
            edit.css('display','inline');
            name.css('display','none');
            if(childrendiv) childrendiv.css('display','none');
        };
    
        if (collapsed) {
            edit.css('display','inline');
            name.css('display','none');
            if(childrendiv) childrendiv.css('display','none');
        }

        if (nametxt.length === 0) {
            bx.dblclick(dblClkFn);
        } else {
            name.dblclick(dblClkFn);
        }

        bx.data("updateFunc", function() {
            var childText;
            alltxt = nametxt;
            for(var i = 0; i < children.length; ++i) {
                childText = children[i].data("oldText");
                alltxt += (' ' + childText);
            }
            bx.data("oldText", alltxt);
            edit.val(alltxt);

            if(parent) {
                var updateFunc = parent.data("updateFunc");
                updateFunc();
            } else {
                // This is the root, update the cmd
                console.log("this is the root " + nametxt);
                console.log("the new text " + alltxt);
                console.log(self);
                self._modCmd = alltxt;
            }
        });

        return bx;
    },
    
    _boxing: function(box, maxwidth, parent) {
        var children = new Array();
        var alltext = box.name;
        var allChildCollapsed = true;
        var res;
        var bx = $('<div>')
            .addClass('boxParent')
            .width(maxwidth);
        for (var i = 0; i < box.children.length; ++i) {
            res = this._boxing(box.children[i], maxwidth-20, bx);
            children.push(res.div);
            alltext += (' ' + res.text);
            if (!box.children[i].collapsed) {
                allChildCollapsed = false;
            }
        }
        var collapsed = box.collapsed || (allChildCollapsed && box.name.length === 0);
        return {div : this._leaf_box(bx, collapsed, box.name, alltext, children, maxwidth-20, parent), text: alltext};
    },

    _createDlg: function() {
        var self = this;                    

        // dlg width can't be less than footer width
        self.options.minWidth = self._footerWidth;
        self._dlg = self.element
            .dialog(self.options)
            .bind("dialogresizestop", function(event, ui) {
                self._refreshHistoryBoxSize();
            });
    },
 
    // translations to default dialog behavior
    open: function() {
        this._dlg.dialog("option", "position", {at : 'left top', my : 'left top', collision : 'flipfit'});
        this._dlg.dialog("open").dialog("widget").draggable("option","containment","#main-body");
        this._dlg.dialog("widget").appendTo("#main-body");
        if(this._cmdOwner !== null && this._cmdOwner.hasClass('ui-dialog-content')) {
            smartDialogPosition($("#main-body"), this._cmdOwner, this._dlg, ['center']);
        } else {
            // TODO: Here we maximize unused space
        }
        this._refreshHistoryBoxSize();
        this._setTabFocus();
    },

    setFlatCmd: function(cmd) {
        var self = this;
        self._modCmd = cmd;
        this._flatTb.val(cmd);
    },

    close: function() { this._dlg.dialog("close"); },

    showCmd: function(cmd) {
        var self = this;
        self._modCmd = cmd;
        this._flatTb.val(cmd);
        ajaxCall(this, '/app/parse_stmt', {parse_stmt: {qstr:cmd}},'parse_stmt','parsedCmd');
    },

    selHistorySelect: function(pos, sql) {
        var self = this;
        self._historySelect[0].options[pos].selected = true;
        self.showCmd(sql);
    },

    addToHistorySelect: function(sql) {
        var self = this;
        self._historySelect.prepend(
            $('<option>').text(sql)
                .click(function (evt) {
                    evt.preventDefault();
                    self.showCmd($(this).text());
                })
        );
        self.selHistorySelect(0, sql);
    },

    // Use the destroy method to clean up any modifications your widget has made to the DOM
    _destroy: function() {
        this._editDiv.remove();
        this._footerDiv.remove();
        this.element.removeAttr('style class scrolltop scrollleft');
    },

  });
}( jQuery ) );

// $(document).ready(function() {    
//     var BOX =
//     {"ind":0,"name":"select","children":[
//         {"ind":1,"name":"","children":[
//             {"ind":2,"name":"c.owner","children":[],"collapsed":false,"error":"","color":"black","pick":""},
//             {"ind":2,"name":",","children":[],"collapsed":false,"error":"","color":"black","pick":""},
//             {"ind":2,"name":"v.name","children":[],"collapsed":false,"error":"","color":"black","pick":""}
//             ],"collapsed":false,"error":"","color":"black","pick":""},
//         {"ind":1,"name":"from","children":[
//             {"ind":2,"name":"ddView as v","children":[],"collapsed":false,"error":"","color":"black","pick":""},
//             {"ind":2,"name":",","children":[],"collapsed":false,"error":"","color":"black","pick":""},
//             {"ind":2,"name":"ddCmd as c","children":[],"collapsed":false,"error":"","color":"black","pick":""}
//             ],"collapsed":false,"error":"","color":"black","pick":""},
//         {"ind":1,"name":"where","children":[
//             {"ind":2,"name":"","children":[
//                 {"ind":3,"name":"c.id","children":[],"collapsed":true,"error":"","color":"black","pick":""},
//                 {"ind":3,"name":"=","children":[],"collapsed":true,"error":"","color":"black","pick":""},
//                 {"ind":3,"name":"v.cmd","children":[],"collapsed":true,"error":"","color":"black","pick":""}
//                 ],"collapsed":false,"error":"","color":"black","pick":""},
//             {"ind":2,"name":"and","children":[],"collapsed":false,"error":"","color":"black","pick":""},
//             {"ind":2,"name":"","children":[
//                 {"ind":3,"name":"c.adapters","children":[],"collapsed":true,"error":"","color":"black","pick":""},
//                 {"ind":3,"name":"=","children":[],"collapsed":true,"error":"","color":"black","pick":""},
//                 {"ind":3,"name":"\"[imem]\"","children":[],"collapsed":true,"error":"","color":"black","pick":""}
//                 ],"collapsed":false,"error":"","color":"black","pick":""},
//             {"ind":2,"name":"and","children":[],"collapsed":false,"error":"","color":"black","pick":""},
//             {"ind":2,"name":"","children":[
//                 {"ind":3,"name":"(","children":[],"collapsed":true,"error":"","color":"black","pick":""},
//                 {"ind":3,"name":"","children":[
//                     {"ind":4,"name":"","children":[
//                         {"ind":5,"name":"c.owner","children":[],"collapsed":true,"error":"","color":"black","pick":""},
//                         {"ind":5,"name":"=","children":[],"collapsed":true,"error":"","color":"black","pick":""},
//                         {"ind":5,"name":"user","children":[],"collapsed":true,"error":"","color":"black","pick":""}
//                         ],"collapsed":true,"error":"","color":"black","pick":""},
//                     {"ind":4,"name":"or","children":[],"collapsed":true,"error":"","color":"black","pick":""},
//                     {"ind":4,"name":"","children":[
//                         {"ind":5,"name":"c.owner","children":[],"collapsed":true,"error":"","color":"black","pick":""},
//                         {"ind":5,"name":"=","children":[],"collapsed":true,"error":"","color":"black","pick":""},
//                         {"ind":5,"name":"system","children":[],"collapsed":true,"error":"","color":"black","pick":""}
//                         ],"collapsed":true,"error":"","color":"black","pick":""}
//                     ],"collapsed":true,"error":"","color":"black","pick":""},
//                 {"ind":3,"name":")","children":[],"collapsed":true,"error":"","color":"black","pick":""}
//                 ],"collapsed":false,"error":"","color":"black","pick":""}
//             ],"collapsed":false,"error":"","color":"black","pick":""}
//         ],"collapsed":false,"error":"","color":"black","pick":""};
//     boxing(BOX).div.appendTo(document.body);
// });

