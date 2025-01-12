window.lib4x = window.lib4x || {};
window.lib4x.axt = window.lib4x.axt || {};

/*
 * LIB4X Custom Client-Side Validation Plugin
 * Offers 'Validate Item', 'Validate Page' and 'Validate IG Row' events which 
 * can be used in DA's as to define custom validation logic in a 
 * javascript action.
 */
lib4x.axt.validation = (function($)
{
    let instantValidation = false;      // instant show of any client-side validation messages

    // ==page module
    let pageModule = (function() 
    {
        $(apex.gPageContext$).on("apexreadyend", function(jQueryEvent) { 
            // wrap page.validate as to facilitate the 'Validate Page' event
            // where constraints can be defined on the data row level
            let origPageValidate = apex.page.validate;
            apex.page.validate = function(pLocation){
                let valid = origPageValidate(pLocation);
                let eventObj = {};
                // pass current validity
                eventObj.pageItemsValid = valid;
                eventObj.formData = util.page.getFormData();
                eventObj.valid = true; 
                eventObj.validationMessage = "";    
                apex.event.trigger(apex.gPageContext$, 'lib4x_validate_page', eventObj);
                if (!eventObj.valid)
                {
                    valid = false;
                    let errors = [];
                    errors.push({
                        message: eventObj.validationMessage ? eventObj.validationMessage : 'Page Invalid',
                        location: "page"
                    });
                    apex.message.showErrors(errors);
                }                
                return valid;
            };
        });
    })();    

    // ==items module
    let itemsModule = (function() {    
        let origMessageGoToErrorByIndex;
        $(apex.gPageContext$).on("apexreadyend", function(jQueryEvent) {  
            origMessageGoToErrorByIndex = apex.message.goToErrorByIndex;
            // wrap item.getValidity for each item
            // as to facilitate 'Validate Item' event
            for (const [itemId, apexItem] of Object.entries(apex.items)) {
                if ((apexItem.item_type != "HIDDEN") && (apexItem.getValidity))
                {
                    let isRowItem = util.item.isRowItem(apexItem);
                    // expand getValidity
                    let origGetValidity = apexItem.getValidity;
                    apexItem.getValidity = function(){
                        // if a html5 custom error was set by lib4x, reset the error  
                        // checking for lib4x_customError as APEX might also have set a 
                        // custom error (like in case of min/max validation for Number fields)
                        if (apexItem.node?.setCustomValidity && apexItem.element.data('lib4x_customError'))
                        {
                            let existingMessage = apexItem.node.validationMessage;
                            if (existingMessage == apexItem.element.data('lib4x_customError'))
                            {
                                apexItem.node.setCustomValidity('');
                            }
                            apexItem.element.data('lib4x_customError', null);
                        }
                        // call the std one and if no validation error
                        // trigger for custom validation
                        let validity = origGetValidity.call(apexItem);
                        let isHTML5validation = (validity instanceof ValidityState);
                        if (validity.valid)
                        {
                            if (!(apexItem.isDisabled && apexItem.isDisabled()))
                            {
                                // https://html.spec.whatwg.org/multipage/input.html#the-readonly-attribute:
                                // If the readonly attribute is specified on an input element, the element is barred from constraint validation.
                                if (!(isHTML5validation && (apexItem.element.is('[readonly]'))))
                                {
                                    let eventObj = initEventObj(itemId, apexItem, isRowItem);
                                    apex.event.trigger(apexItem.element, 'lib4x_validate_item', eventObj);
                                    if (!eventObj.valid)
                                    {
                                        if (isHTML5validation)
                                        {
                                            // HTML5 validation 
                                            // validity to be set by setCustomValidity API
                                            let validationMessage = eventObj.validationMessage ? eventObj.validationMessage : 'Invalid value';
                                            apexItem.node.setCustomValidity(validationMessage);
                                            apexItem.element.data('lib4x_customError', validationMessage);
                                        }
                                        else
                                        {
                                            // validity is a regular object
                                            validity.customError = true;
                                            validity.valid = false;
                                            // in case of custom error, item.getValidationMessage will take the message from 'data-valid-message' attribute
                                            // overrule with message from eventObj
                                            // like this, there is no need to wrap the item.getValidationMessage method
                                            apexItem.element.attr('data-valid-message', eventObj.validationMessage ? eventObj.validationMessage : 'Invalid value' );
                                        }
                                    }
                                }
                            }
                        }
                        return validity;
                    }
                    if (!isRowItem && instantValidation)
                    {
                        // keep dirty flag
                        // when user enters a value and then reverts it again, item.isChanged will
                        // be false but the dirty flag will be true
                        apexItem.element.on('change', function(jQueryEvent){  
                            apexItem.element.data('lib4x_dirty', true);
                        });  
                        // define instant validation feedback on focusout                      
                        apexItem.element.on('focusout', function(jQueryEvent){  
                            if (apexItem.element.data('lib4x_dirty'))
                            {
                                validatePageItem(apexItem.id);                                   
                            }
                        });
                    }
                }
            }
        });  
        
        /*
         * validatePageItem
        /* gives validation feedback for the given item
         * makes use of the undocumented itemId argument in message.clearErrors(itemId)
         * in case you don't want, switch off 'instant validation'
         */
        function validatePageItem(itemId)
        {
            let apexItem = apex.item(itemId);
            if ((apexItem.id) && (!(apexItem.isDisabled && apexItem.isDisabled())))
            {
                if (!apexItem.getValidity().valid)
                {
                    let validationMessage = apexItem.getValidationMessage();
                    let existingMessage = $('#' + itemId + '_error').text();
                    if (!existingMessage || existingMessage != validationMessage)
                    {
                        // call clearErrors on the item even if there's no existing message, so the 
                        // error stack gets cleared, preventing any page error(s) shown before (but clicked away
                        // by the user) to pop up again, and preventing the display logic for existing item messages 
                        // so the showErrors below will just only handle the current item
                        apex.message.clearErrors(itemId);
                        let errors = [];
                        errors.push({
                            message: validationMessage,
                            location: "inline",
                            pageItem: itemId
                        });
                        // prevent the focus to be kept on the field and not moving to the next field
                        // as caused by goToErrorByIndex(0)
                        // which would be inconsistent with the behavior in IG
                        apex.message.goToErrorByIndex = function(index) {};
                        apex.message.showErrors(errors);
                        apex.message.goToErrorByIndex = origMessageGoToErrorByIndex;
                    }    
                } 
                else
                {
                    apex.message.clearErrors(itemId);
                }                                          
            }            
        }

        // initialize event object for item validation
        function initEventObj(itemId, apexItem, isRowItem)
        {
            let eventObj = {};
            eventObj.itemId = itemId;
            eventObj.apexItem = apexItem;
            eventObj.value = apexItem.getValue();
            eventObj.nativeValue = util.item.getNativeValue(apexItem);
            if (apexItem.item_type == "NUMBER")
            {
                try
                {
                    let dataFormat = apexItem.element.data('format');
                    eventObj.formattedValue = apex.locale.formatNumber(eventObj.nativeValue, dataFormat);
                }
                catch(e) {};
            } 
            if (apexItem.hasDisplayValue())
            {
                eventObj.displayValue = util.item.getDisplayValue(apexItem, eventObj);
            } 
            if (isRowItem)
            {
                let widget$ = apexItem.element.closest('.a-IG');    // IG grid/single row view (SRV)
                if (widget$.length)
                {
                    eventObj.regionStaticId = widget$.interactiveGrid('option').config.regionStaticId;
                    let gridView = widget$.interactiveGrid('getViews').grid;
                    eventObj.model = gridView.model;
                    eventObj.activeRecordId = gridView.getActiveRecordId();
                    // when record is deleted, still getValidity is called by APEX, but there might be no active record
                    if (eventObj.activeRecordId)
                    {
                        eventObj.activeRecord = util.ig.getActiveRecord(gridView);
                        eventObj.activeRecordMetadata = eventObj.model.getRecordMetadata(eventObj.activeRecordId);
                    }
                    let columns = gridView.view$.grid('getColumns');
                    eventObj.property = columns.find(c=>c.elementId == itemId)?.property;
                    eventObj.rowData = util.ig.getRowData(gridView);
                    let origRecord = eventObj.activeRecordMetadata?.original;
                    if (eventObj.property && (origRecord || eventObj.activeRecord))
                    {
                        eventObj.oldValue = eventObj.model.getValue(origRecord ? origRecord : eventObj.activeRecord, eventObj.property);
                    }
                }
                else
                {
                    widget$ = apexItem.element.closest('.a-RV');    // row view, implemented by recordView widget
                    // can be an RV in context of an ERV, but also in other context!
                    if (widget$.length)
                    {
                        // for LIB4X ERV, regionStaticId will be set as an option on the recordView
                        // for other situations, it might just give null
                        eventObj.regionStaticId = widget$.recordView('option', 'regionStaticId');
                        eventObj.model = widget$.recordView('getModel');
                        eventObj.activeRecordId = widget$.recordView('getActiveRecordId');
                        if (eventObj.activeRecordId)
                        {
                            eventObj.activeRecord = widget$.recordView('getActiveRecord');
                            eventObj.activeRecordMetadata = eventObj.model.getRecordMetadata(eventObj.activeRecordId);
                        }
                        let fields = widget$.recordView('option', 'fields');
                        eventObj.property = fields[0][Object.keys(fields[0]).filter((key)=> fields[0][key].elementId == 'c_name')]?.property;
                        eventObj.rowData = util.recordView.getRecordData(widget$.attr('id'));
                        let origRecord = eventObj.activeRecordMetadata?.original;
                        if (eventObj.property && (origRecord || eventObj.activeRecord))
                        {
                            eventObj.oldValue = eventObj.model.getValue(origRecord ? origRecord : eventObj.activeRecord, eventObj.property);
                        } 
                    }                       
                }
            }    
            else
            {
                eventObj.formData = util.page.getFormData();
            }                                                                                           
            eventObj.valid = true;
            eventObj.validationMessage = "";  
            return eventObj;                  
        }  
        
        return{
            validatePageItem: validatePageItem
        }        
    })();   

    // ==grids module
    let gridsModule = (function() {
        $(apex.gPageContext$).on("apexreadyend", function(jQueryEvent) {
            // for each IG, validate the active row upon endrecordedit and before save
            $('.a-IG').each(function(){  
                let regionStaticId = $(this).interactiveGrid('option').config.regionStaticId;
                let gridView = $(this).interactiveGrid('getViews').grid;
                let igActions = $(this).interactiveGrid('getActions');
                let saveAction = igActions.lookup("save");
                if (saveAction)
                {
                    let origActionFunction = saveAction.action;
                    saveAction.action = function(jQueryEvent, element) {
                        let subwidgetInst = util.ig.getCurrentSubwidgetInst(gridView); 
                        // make sure the grid (or recordView) is done any editing
                        subwidgetInst.finishEditing().done( () => {
                            if (inEditMode(gridView))
                            {
                                // do any needed validation as apex is skipping endrecordedit upon save click
                                validateActiveRow(regionStaticId);
                                origActionFunction(jQueryEvent, element);
                            }  
                            else
                            {
                                // check any related external row view
                                // only one view (gridView or ext recordView) can be in edit mode
                                let rv$ = $('.lib4x-ig-erv .a-RV').filter(function() {
                                    // model regionStaticId is the IG static Id
                                    return (($(this).recordView('getModel').getOption('regionStaticId') == regionStaticId) && ($(this).recordView('inEditMode'))) 
                                }).first(); // take first to be sure
                                if (rv$.length)
                                {
                                    let finishEditing = rv$.recordView('finishEditing');
                                    finishEditing.done( () => {
                                        rowViewsModule.validateActiveRow(rv$);
                                        origActionFunction(jQueryEvent, element);
                                    });
                                }  
                                else
                                {
                                    origActionFunction(jQueryEvent, element);
                                }                            
                            }                          
                        });
                    };  
                }                                      
                // apexendrecordedit
                $(this).on('apexendrecordedit', function(jQueryEvent){
                    validateActiveRow(regionStaticId);
                });  
            });
        });

        // gives validation feedback for any active row
        // APEX has no specific row validation configuration, but 
        // offers the model.setValidity API, which we utilize here
        // upon firing the 'Validate Row' event
        function validateActiveRow(regionStaticId)
        {
            let gridView = apex.region(regionStaticId).call('getViews').grid;
            let activeRecordId = gridView.getActiveRecordId();
            if (activeRecordId)
            {
                let eventObj = {};
                eventObj.activeRecordId = activeRecordId;
                eventObj.activeRecord = util.ig.getActiveRecord(gridView);
                eventObj.activeRecordMetadata = gridView.model.getRecordMetadata(activeRecordId);                 
                let recordChanged = modelsModule.util.recordInEditMode(eventObj.activeRecordMetadata);
                if (recordChanged)
                {
                    let ig$ = $('#' + regionStaticId);
                    eventObj.regionStaticId = regionStaticId;
                    eventObj.rowData = util.ig.getRowData(gridView);
                    eventObj.rowItemsValid = modelsModule.util.recordFieldsValid(eventObj.activeRecordMetadata);
                    eventObj.model = gridView.model;
                    eventObj.valid = true;
                    eventObj.validationMessage = "";
                    apex.event.trigger(ig$, 'lib4x_ig_validate_row', eventObj);
                    if (!eventObj.valid)
                    {
                        gridView.model.setValidity("error", eventObj.activeRecordId, null, eventObj.validationMessage ? eventObj.validationMessage : "Invalid Row");
                    }
                    else 
                    {
                        gridView.model.setValidity("valid", eventObj.activeRecordId);
                    }                          
                } 
            }           
        }   
        
        // check if the IG grid is in edit mode
        function inEditMode(gridView)
        {
            return (gridView.singleRowMode ? gridView.singleRowView$.recordView('inEditMode') : gridView.view$.grid('inEditMode'));
        }  
        
        return{
            validateActiveRow: validateActiveRow
        }
    })();    

    // ==rowViews module 
    // Can be an IG External Row View, or some 
    // other Row View (outside of IG) implemented by recordView widget
    let rowViewsModule = (function() {
        $(apex.gPageContext$).on("apexreadyend", function(jQueryEvent) {
            // for each RV, validate the active row upon endrecordedit
            $('.a-RV').each(function(){  
                // apexendrecordedit
                $(this).on('apexendrecordedit lib4x_rv_do_validate_row', function(jQueryEvent){
                    validateActiveRow($(this));
                });  
            });
        });

        // gives validation feedback for any active row
        // APEX has no specific record validation configuration, but 
        // offers the model.setValidity API, which we utilize here
        // upon firing the 'Validate Row' event
        function validateActiveRow(widget$)
        {
            let rvStaticIdRv = widget$.attr('id');
            // for LIB4X ERV, regionStaticId will be set as an option on the recordView
            // for other situations, it might just give null
            let regionStaticId = widget$.recordView('option', 'regionStaticId');
            let activeRecordId = widget$.recordView('getActiveRecordId');
            if (activeRecordId)
            {
                let model = widget$.recordView('getModel');
                let eventObj = {};
                eventObj.activeRecordId = activeRecordId;
                eventObj.activeRecord = widget$.recordView('getActiveRecord');
                eventObj.activeRecordMetadata = model.getRecordMetadata(activeRecordId);                 
                let recordChanged = modelsModule.util.recordInEditMode(eventObj.activeRecordMetadata);
                if (recordChanged)
                {
                    eventObj.regionStaticId = regionStaticId;
                    eventObj.rowData = util.recordView.getRecordData(rvStaticIdRv);
                    eventObj.rowItemsValid = modelsModule.util.recordFieldsValid(eventObj.activeRecordMetadata);                        
                    eventObj.model = model;
                    eventObj.valid = true;
                    eventObj.validationMessage = "";
                    apex.event.trigger(widget$, 'lib4x_rv_validate_row', eventObj);
                    if (!eventObj.valid)
                    {
                        model.setValidity("error", eventObj.activeRecordId, null, eventObj.validationMessage ? eventObj.validationMessage : "Invalid Row");
                    }
                    else 
                    {
                        model.setValidity("valid", eventObj.activeRecordId);
                    }                          
                } 
            }           
        }   
        
        return{
            validateActiveRow: validateActiveRow
        }
    })();     

    // ==models module
    let modelsModule = (function() {
        let modelUtil = {
            recordInEditMode: function(recMetadata)
            {
                return (recMetadata && (recMetadata.updated || recMetadata.inserted || recMetadata.autoInserted));                
            },
            recordFieldsValid: function(recMetadata)
            {
                let valid = true;
                if (recMetadata)
                {
                    let fields = recMetadata.fields;
                    if (fields)
                    {
                        for (const field in fields) 
                        {
                            if (fields[field].error)
                            {
                                valid = false;
                                break;
                            }
                        }
                    }
                }
                return valid;                
            }
        };

        return{
            util: modelUtil
        }
    })();    
    
    // ==util module
    let util = {    
        item:
        {
            isRowItem: function(apexItem)
            {
                // A row item is an item in an IG grid, single row view, or in a 
                // row view (outside of IG) implemented with recordView widget
                return ((apexItem.element.closest('.a-GV-columnItem').length > 0) ||
                        (apexItem.element.closest('.a-RV-fieldValue').length > 0));
            },
            getNativeValue: function(apexItem)
            {
                let result = null;
                if (apexItem.item_type == "NUMBER")
                {
                    result = apexItem.getNativeValue();
                    if (isNaN(result))
                    {
                        result = null;
                    }
                }
                else if ((apexItem.item_type == "QE") || (apexItem.item_type == "WE") || (apexItem.item_type == "ZE") || (apexItem.item_type == "DATE_PICKER") || (apexItem.node?.nodeName == 'A-DATE-PICKER'))
                {
                    try
                    {
                        result = apex.date.parse(apexItem.getValue(), this.getDateFormat(apexItem));
                    }
                    catch(e) {};                
                }
                else
                {
                    result = apexItem.getValue();
                }
                return result;
            },
            getDisplayValue: function(apexItem, eventObj)
            {
                let displayValue = apexItem.displayValueFor(eventObj.value);
                if (displayValue && apexItem.item_type == "SINGLE_CHECKBOX")    // by default, it gives a span element as string 
                {
                    let checkedLabel = apex.lang.getMessage( "APEX.ITEM_TYPE.CHECKBOX.CHECKED");
                    let uncheckedLabel = apex.lang.getMessage( "APEX.ITEM_TYPE.CHECKBOX.UNCHECKED")
                    if (displayValue.indexOf(uncheckedLabel) > -1)
                    {
                        displayValue = uncheckedLabel;
                    }
                    else if (displayValue.indexOf(checkedLabel) > -1)
                    {
                        displayValue = checkedLabel;
                    }
                    else
                    {
                        displayValue = "";
                    }
                } 
                return displayValue;               
            },
            getDateFormat: function(apexItem)
            {
                let dateFormat = apexItem.element.attr('format');  // regular attribute!
                if (!dateFormat)
                {
                    dateFormat = apex.locale.getDateFormat();
                } 
                return dateFormat;               
            },            
        },
        ig:
        {
            getGridInst: function(gridView)
            {
                return gridView.view$.grid("instance");
            },
            getRecordViewInst: function(gridView)
            {
                return gridView.singleRowView$.recordView("instance");
            },
            getCurrentSubwidgetInst: function(gridView)
            {
                let subwidgetInst = null;
                if (gridView.singleRowMode)
                {
                    subwidgetInst = this.getRecordViewInst(gridView);
                }
                else
                {
                    subwidgetInst = this.getGridInst(gridView);
                }
                return subwidgetInst;
            }, 
            // getActiveRecord: record data from model
            getActiveRecord: function(gridView)
            {
                return (gridView.singleRowMode ? gridView.singleRowView$.recordView('getActiveRecord') : gridView.view$.grid('getActiveRecord'));
            },    
            // getRowData: data from column items
            getRowData: function(gridView)
            {
                let activeRow = null;
                // check if there is a row active by checking the activeRecordId
                let activeRecordId = gridView.getActiveRecordId();
                if (activeRecordId)
                {
                    activeRow = {};
                    let columns = gridView.view$.grid('getColumns');
                    for (column of columns)
                    {
                        if (column.elementId && apex.items.hasOwnProperty(column.elementId))
                        {
                            activeRow[column.elementId] = util.item.getNativeValue(apex.item(column.elementId));
                        }
                    }
                }
                return activeRow;
            }
        },
        recordView:
        {
            // getRecordData: data from RV fields
            getRecordData: function(rvStaticIdRv)
            {
                let widget$ = $('#' + rvStaticIdRv);
                let recordData = null;
                // check if there is a record active by checking the activeRecordId
                let activeRecordId = widget$.recordView('getActiveRecordId');
                if (activeRecordId)
                {
                    recordData = {};
                    let fields = widget$.recordView('getFields');
                    for (field of fields)
                    {
                        if (field.elementId && apex.items.hasOwnProperty(field.elementId))
                        {
                            recordData[field.elementId] = util.item.getNativeValue(apex.item(field.elementId));
                        }
                    }
                }
                return recordData;
            }
        },
        page:
        {
            getFormData: function()
            {
                let formData = {};
                for (const [itemId, apexItem] of Object.entries(apex.items)) 
                {
                    let isRowItem = util.item.isRowItem(apexItem);    
                    if (!isRowItem)
                    {
                        formData[itemId] = util.item.getNativeValue(apexItem);
                    }
                }
                return formData;
            }
        }
    }    
    
    // called by the DA as to init the plugin
    let init = function()
    {
        let daThis = this;
        instantValidation = (daThis.action.attribute01 == 'Y');
    }

    return{
        _init: init,
        validatePageItem: itemsModule.validatePageItem,
        ig: {
            validateActiveRow: gridsModule.validateActiveRow
        },
        rv: {
            validateActiveRow: rowViewsModule.validateActiveRow
        }        
    }    
})(apex.jQuery);      
